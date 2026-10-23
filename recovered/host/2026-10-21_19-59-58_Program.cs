// BodySnatch Desktop — нативное окно Windows для веб-интерфейса.
//
// Что делает:
//   1) находит корень приложения (папку с proxy/src/main.mjs);
//   2) запускает прокси (bodysnatch-proxy.exe, иначе node proxy/src/main.mjs);
//   3) ждёт готовности API и открывает интерфейс в WebView2 (движок Edge);
//   4) окно без системной шапки: своя шапка в интерфейсе, размер по контенту;
//   5) «свернуть» — в панель задач, «закрыть» — в трей (прокси продолжает работать);
//   6) при выходе из трея просит прокси завершиться (он вернёт системный прокси).

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BodySnatchHost
{
    internal static class Program
    {
        private const string AppVersion = "0.1.0";

        private static string root;
        private static int port = 8180;
        private static string configPath;
        private static Process agent;
        private static FramelessForm window;
        private static WebView2 web;
        private static NotifyIcon tray;
        private static string uiUrl;
        private static string uiOverride;
        private static bool exiting;
        private static bool dev;
        // мастер пройден: только тогда закрытие уводит приложение в трей
        private static bool configured;
        private static bool forceConfigured; // тестовый режим: всегда считать мастер пройденным
        private static int msgW;
        private static int msgH;
        private static Mutex instanceMutex;
        private static EventWaitHandle showEvent;

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                return Run(args);
            }
            catch (Exception ex)
            {
                try
                {
                    var dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
                    Directory.CreateDirectory(dir);
                    File.AppendAllText(Path.Combine(dir, "host.log"), DateTime.Now.ToString("HH:mm:ss.fff") + "  ФАТАЛЬНО: " + ex + Environment.NewLine, Encoding.UTF8);
                }
                catch { }
                return 9;
            }
        }

        /// Низкий уровень целостности токена (S-1-16-4096) — признак песочницы.
        private static bool IsLowIntegrity()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "whoami",
                    Arguments = "/groups",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using (var p = Process.Start(psi))
                {
                    var outText = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    return outText.Contains("S-1-16-4096");
                }
            }
            catch
            {
                return false;
            }
        }
        /// Метка целостности текущего процесса одной строкой (для журнала).
        private static string IntegrityLabel()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "whoami",
                    Arguments = "/groups",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using (var p = Process.Start(psi))
                {
                    var text = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    foreach (var line in text.Split('\n'))
                    {
                        if (line.Contains("S-1-16-")) return line.Trim();
                    }
                }
                return "метка не определена";
            }
            catch (Exception ex)
            {
                return "метка: ошибка " + ex.Message;
            }
        }
        /// Кто нас запустил: имя и pid родителя. Без WMI — через снимок процессов.
        private static string ParentProcessInfo()
        {
            try
            {
                var me = Process.GetCurrentProcess();
                var parentId = ParentPid(me.Id);
                if (parentId <= 0) return "неизвестен";
                var parent = Process.GetProcessById(parentId);
                return parent.ProcessName + " (pid " + parentId + ")";
            }
            catch
            {
                return "неизвестен";
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private static int ParentPid(int pid)
        {
            var snapshot = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (snapshot == IntPtr.Zero || snapshot.ToInt64() == -1) return 0;
            try
            {
                var entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (!Process32First(snapshot, ref entry)) return 0;
                do
                {
                    if ((int)entry.th32ProcessID == pid) return (int)entry.th32ParentProcessID;
                }
                while (Process32Next(snapshot, ref entry));
                return 0;
            }
            finally
            {
                CloseHandle(snapshot);
            }
        }
        private static int Run(string[] args)
        {
            // Диагностика запуска: родитель и фактическая метка целостности.
            try
            {
                WriteLog("запуск: родитель " + ParentProcessInfo() + ", " + IntegrityLabel());
            }
            catch { }

            // Привилегированный помощник: включаем/возвращаем системный прокси.
            // Запускается отдельным процессом с запросом прав (UAC) и сразу выходит.
            if (Array.IndexOf(args, "--elevated-proxy") >= 0)
            {
                return ElevatedProxy(args);
            }

            // Песочница (низкий уровень целостности): там Windows запрещает
            // установку сертификатов, запись профиля и WebView2 не запускается.
            // Говорим об этом прямо, вместо непонятного E_UNEXPECTED.
            if (Array.IndexOf(args, "--allow-sandbox") < 0 && IsLowIntegrity())
            {
                // Проводник из такого процесса запустить нельзя (он и падал),
                // поэтому просто показываем путь — его можно скопировать.
                MessageBox.Show(
                    "Приложение запущено с низким уровнем целостности (S-1-16-4096).\n" +
                    "Windows в таком режиме запрещает установку сертификата, запись настроек,\n" +
                    "и окно с интерфейсом не может запуститься.\n\n" +
                    "Родительский процесс: " + ParentProcessInfo() + "\n" +
                    "EXE: " + System.Reflection.Assembly.GetEntryAssembly().Location,
                    "BodySnatch Desktop",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return 7;
            }

            for (var i = 0; i < args.Length; i++)
            {
                if (args[i] == "--port" && i + 1 < args.Length) int.TryParse(args[i + 1], out port);
                if (args[i] == "--config" && i + 1 < args.Length) configPath = args[i + 1];
                if (args[i] == "--dev" || args[i] == "-d") dev = true;
                if (args[i] == "--configured") forceConfigured = true;
                if (args[i] == "--ui" && i + 1 < args.Length) uiOverride = args[i + 1];
                if (args[i] == "--selftest")
                {
                    // Диагностика без окна: печатаем уровень целостности и родителя.
                    var report = new System.Text.StringBuilder();
                    report.AppendLine("selftest");
                    report.AppendLine("parent: " + ParentProcessInfo());
                    try
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = "whoami",
                            Arguments = "/groups",
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            RedirectStandardOutput = true,
                        };
                        using (var sp = Process.Start(psi))
                        {
                            var txt = sp.StandardOutput.ReadToEnd();
                            sp.WaitForExit(3000);
                            foreach (var line in txt.Split('\n'))
                            {
                                if (line.Contains("S-1-16-")) report.AppendLine("label: " + line.Trim());
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        report.AppendLine("label: ошибка " + ex.Message);
                    }
                    Console.WriteLine("isLowIntegrity: " + IsLowIntegrity());
                    return 0;
                }
                if (args[i] == "--version")
                {
                    Console.WriteLine(AppVersion);
                    return 0;
                }
            }

            root = FindRoot();
            if (root == null)
            {
                MessageBox.Show("Не найдена папка приложения (proxy/src/main.mjs).", "BodySnatch Desktop", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
            if (configPath == null) configPath = Path.Combine(root, "config", "rules.json");
            // --ui позволяет грузить интерфейс с dev-сервера Vite (горячая перезагрузка)
            uiUrl = string.IsNullOrWhiteSpace(uiOverride) ? "http://127.0.0.1:" + port + "/" : uiOverride;

            // Один экземпляр: повторный запуск не поднимает второй прокси, а показывает
            // уже открытое окно (оно может быть свёрнуто в трей).
            instanceMutex = new Mutex(true, "BodySnatchDesktop.Instance", out var first);
            if (!first)
            {
                try
                {
                    using (var wake = EventWaitHandle.OpenExisting("BodySnatchDesktop.Show"))
                    {
                        wake.Set();
                    }
                }
                catch { }
                return 0;
            }
            try
            {
                showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "BodySnatchDesktop.Show");
            }
            catch { }

            if (!StartAgent()) return 3;
            if (!WaitForApi(TimeSpan.FromSeconds(30)))
            {
                MessageBox.Show("Прокси не запустился за 30 секунд.\nСмотрите data\\host.log", "BodySnatch Desktop", MessageBoxButtons.OK, MessageBoxIcon.Error);
                StopAgent();
                return 4;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            BuildWindow();
            EnsureTray();

            // будим окно по сигналу от повторного запуска
            if (showEvent != null)
            {
                var wake = new Thread(() =>
                {
                    while (!exiting)
                    {
                        try
                        {
                            if (!showEvent.WaitOne(1000)) continue;
                            window.BeginInvoke(new Action(ShowFromTray));
                        }
                        catch
                        {
                            break;
                        }
                    }
                });
                wake.IsBackground = true;
                wake.Start();
            }

            Application.Run(window);
            return 0;
        }

        private static bool IsElevated()
        {
            try
            {
                using (var id = System.Security.Principal.WindowsIdentity.GetCurrent())
                {
                    var principal = new System.Security.Principal.WindowsPrincipal(id);
                    return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindRoot()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (var i = 0; i < 4 && dir != null; i++, dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "proxy", "src", "main.mjs"))) return dir.FullName;
            }
            return null;
        }

        private static bool StartAgent()
        {
            var exe = Path.Combine(root, "bodysnatch-proxy.exe");
            var psi = new ProcessStartInfo
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = root,
            };
            if (File.Exists(exe))
            {
                psi.FileName = exe;
            }
            else
            {
                // в поставке рядом с bodysnatch.exe лежит свой node.exe
                var localNode = Path.Combine(root, "node.exe");
                psi.FileName = File.Exists(localNode) ? localNode : "node";
                psi.Arguments = "\"proxy/src/main.mjs\" --port " + port + " --config \"" + configPath + "\"";
            }
            try
            {
                agent = Process.Start(psi);
                agent.OutputDataReceived += (s, e) => { if (e.Data != null) WriteLog(e.Data); };
                agent.ErrorDataReceived += (s, e) => { if (e.Data != null) WriteLog("[err] " + e.Data); };
                agent.BeginOutputReadLine();
                agent.BeginErrorReadLine();
                return true;
            }
            catch (Exception ex)
            {
                WriteLog("не удалось запустить прокси: " + ex.Message);
                return false;
            }
        }

        private static bool WaitForApi(TimeSpan timeout)
        {
            var until = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < until)
            {
                try
                {
                    using (var http = new WebClient())
                    {
                        http.Encoding = Encoding.UTF8;
                        var body = http.DownloadString("http://127.0.0.1:" + port + "/api/state");
                        if (body != null && body.Contains("\"ok\"")) return true;
                    }
                }
                catch { }
                Thread.Sleep(300);
            }
            return false;
        }

        private static void WriteLog(string message)
        {
            try
            {
                var dir = Path.Combine(root ?? AppDomain.CurrentDomain.BaseDirectory, "data");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "host.log"), DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        private static void BuildWindow()
        {
            window = new FramelessForm
            {
                Text = "BodySnatch Desktop",
                Width = 600,
                Height = 300,
                MinimumSize = new Size(600, 300),
                StartPosition = FormStartPosition.CenterScreen,
                BackColor = Color.White,
                Icon = LoadIcon(),
            };

            var status = new Label
            {
                Text = "Запускаю…",
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 11F),
                ForeColor = Color.FromArgb(95, 99, 104),
            };
            window.Controls.Add(status);

            window.Shown += async (_, __) =>
            {
                try
                {
                    // Профиль WebView2 нельзя делить между обычным и повышенным запуском:
                    // при запуске от администратора WebView2 на общем каталоге виснет.
                    var elevated = IsElevated();
                    var suffix = elevated ? "-admin" : "";
                    var candidates = new[]
                    {
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BodySnatch", "webview2" + suffix),
                        Path.Combine(root, ".bodysnatch-profile" + suffix),
                    };
                    string userData = null;
                    foreach (var candidate in candidates)
                    {
                        try
                        {
                            Directory.CreateDirectory(candidate);
                            userData = candidate;
                            break;
                        }
                        catch (Exception ex)
                        {
                            WriteLog("профиль WebView2: " + candidate + " недоступен — " + ex.Message);
                        }
                    }
                    WriteLog("профиль WebView2: " + (userData ?? "(по умолчанию)") + (elevated ? " (администратор)" : ""));

                    var envTask = CoreWebView2Environment.CreateAsync(null, userData, null);
                    if (await Task.WhenAny(envTask, Task.Delay(25000)) != envTask)
                    {
                        WriteLog("WebView2: CreateAsync не ответил за 25 с");
                        status.Text = "WebView2 не запустился за 25 секунд.\n\nПодробности — в data\\host.log рядом с приложением.";
                        return;
                    }
                    var env = await envTask;

                    web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
                    var initTask = web.EnsureCoreWebView2Async(env);
                    if (await Task.WhenAny(initTask, Task.Delay(25000)) != initTask)
                    {
                        WriteLog("WebView2: EnsureCoreWebView2Async не ответил за 25 с");
                        status.Text = "WebView2 не запустился за 25 секунд.\n\nПодробности — в data\\host.log рядом с приложением.";
                        return;
                    }
                    await initTask;

                    var s = web.CoreWebView2.Settings;
                    s.IsStatusBarEnabled = false;
                    s.IsZoomControlEnabled = false;
                    // контекстное меню и инструменты разработчика — только с --dev
                    s.AreDefaultContextMenusEnabled = dev;
                    s.AreDevToolsEnabled = dev;
                    s.AreBrowserAcceleratorKeysEnabled = dev;

                    web.CoreWebView2.NewWindowRequested += (_, e) =>
                    {
                        e.Handled = true;
                        try { Process.Start(e.Uri); } catch { }
                    };

                    // сообщения из страницы: перетаскивание, кнопки шапки, размер по контенту
                    web.CoreWebView2.WebMessageReceived += (_, e) =>
                    {
                        var cmd = (string)null;
                        msgW = 0;
                        msgH = 0;
                        try
                        {
                            var raw = e.WebMessageAsJson;
                            if (string.IsNullOrEmpty(raw) || raw == "null") raw = e.TryGetWebMessageAsString();
                            if (!string.IsNullOrEmpty(raw))
                            {
                                var m = Regex.Match(raw, "\"bs\"\\s*:\\s*\"([a-z]+)\"");
                                if (m.Success) cmd = m.Groups[1].Value;
                                var mw = Regex.Match(raw, "\"w\"\\s*:\\s*(\\d+)");
                                var mh = Regex.Match(raw, "\"h\"\\s*:\\s*(\\d+)");
                                if (mw.Success) msgW = int.Parse(mw.Groups[1].Value);
                                if (mh.Success) msgH = int.Parse(mh.Groups[1].Value);
                                var mstep = Regex.Match(raw, "\"step\"\\s*:\\s*\"([a-z]+)\"");
                                if (mstep.Success)
                {
                    var wasConfigured = configured;
                    configured = forceConfigured || mstep.Groups[1].Value == "run" || mstep.Groups[1].Value == "work";
                    // на рабочем экране окно должно следовать за содержимым,
                    // поэтому забываем ручную высоту
                    if (configured && !wasConfigured) window.ResetUserHeight();
                }
                            }
                        }
                        catch { }
                        if (cmd == null) return;
                        switch (cmd)
                        {
                            case "drag":
                                ReleaseCapture();
                                SendMessage(window.Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                                break;
                            case "minimize":
                                window.WindowState = FormWindowState.Minimized;
                                break;
                            case "close":
                                RequestClose();
                                break;
                            case "resize":
                                window.FitToContent(msgW, msgH);
                                break;
                            case "show":
                                ShowFromTray();
                                break;
                        }
                    };

                    window.Controls.Remove(status);
                    status.Dispose();
                    window.Controls.Add(web);
                    web.CoreWebView2.Navigate(uiUrl + (uiUrl.Contains("?") ? "&" : "?") + "v=" + DateTime.Now.Ticks);
                }
                catch (Exception ex)
                {
                    WriteLog("ошибка WebView2: " + ex);
                    status.Text = "WebView2 недоступен:\n" + ex.Message +
                                  "\n\nУстановите «WebView2 Runtime» (обычно уже есть в Windows 10/11).";
                }
            };

            Application.ThreadException += (_, e) => WriteLog("ThreadException: " + e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (_, e) => WriteLog("UnhandledException: " + e.ExceptionObject);

            window.FormClosing += (_, e) =>
            {
                if (exiting) return;
                if (!configured)
                {
                    // на этапе настройки закрытие = выход: прокси вернётся в исходное состояние
                    exiting = true;
                    QuitAgent();
                    return;
                }
                // работа уже настроена — прячемся в трей, подмена продолжает работать
                e.Cancel = true;
                HideToTray();
            };
        }

        private static Icon LoadIcon()
        {
            try
            {
                var ico = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
                if (File.Exists(ico)) return new Icon(ico);
            }
            catch { }
            return SystemIcons.Application;
        }

        /// «Закрыть» — уйти в трей: прокси продолжает работать.
        private static void HideToTray()
        {
            try
            {
                window.Hide();
                window.ShowInTaskbar = false;
            }
            catch { }
            // Объясняем, куда делось окно: иначе это выглядит как «приложение закрылось».
            NotifyToTray();
        }

        /// Windows-уведомление о работе в фоне (один раз за запуск).
        private static bool trayTipShown;
        private static void NotifyToTray()
        {
            if (trayTipShown) return;
            trayTipShown = true;
            try
            {
                EnsureTray();
                if (tray == null) return;
                tray.BalloonTipTitle = "BodySnatch работает в фоне";
                tray.BalloonTipText =
                    "Окно свёрнуто в трей: подмена продолжает работать.\n" +
                    "Открыть — двойной щелчок по значку, выйти — правый клик → «Остановить и выйти».";
                tray.BalloonTipIcon = ToolTipIcon.Info;
                tray.ShowBalloonTip(6000);
            }
            catch { }
        }

        private static void ShowFromTray()
        {
            try
            {
                window.ShowInTaskbar = true;
                window.Show();
                window.WindowState = FormWindowState.Normal;
                window.Activate();
            }
            catch { }
        }

        /// Закрытие по кнопке в шапке: на настройке выходим, в работе — в трей.
        private static void RequestClose()
        {
            if (!configured)
            {
                exiting = true;
                QuitAgent();
                try { window.Close(); } catch { }
                return;
            }
            HideToTray();
        }

        /// Выключить системный прокси, не подвешивая закрытие окна.
        private static void DisableProxyInBackground()
        {
            var worker = new Thread(() =>
            {
                try
                {
                    using (var http = new WebClient { Encoding = Encoding.UTF8 })
                    {
                        http.Headers["Content-Type"] = "application/json";
                        http.UploadString("http://127.0.0.1:" + port + "/api/proxy/off", "POST", "{}");
                    }
                }
                catch (Exception ex)
                {
                    WriteLog("выключение прокси при закрытии: " + ex.Message);
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private static void EnsureTray()
        {
            if (tray != null) return;
            tray = new NotifyIcon
            {
                Icon = LoadIcon(),
                Text = "BodySnatch Desktop",
                Visible = true,
            };
            var menu = new ContextMenuStrip();
            menu.Items.Add("Открыть", null, (_, __) => ShowFromTray());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Остановить и выйти", null, (_, __) => ExitApp());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (_, __) => ShowFromTray();
        }

        private static void ExitApp()
        {
            exiting = true;
            try
            {
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                    tray = null;
                }
            }
            catch { }
            QuitAgent();
            try { window.Close(); } catch { }
            Application.Exit();
        }

        /// Просим прокси завершиться штатно, чтобы он вернул системный прокси.
        private static void QuitAgent()
        {
            try
            {
                using (var http = new WebClient { Encoding = Encoding.UTF8 })
                {
                    http.Headers["Content-Type"] = "application/json";
                    http.UploadString("http://127.0.0.1:" + port + "/api/quit", "POST", "{}");
                }
            }
            catch { }

            // Даём прокси время вернуть системные настройки и выйти самому.
            for (var i = 0; i < 80; i += 1)
            {
                try
                {
                    if (agent == null || agent.HasExited) return;
                }
                catch
                {
                    return;
                }
                Thread.Sleep(50);
            }
            StopAgent();
        }

        private static void StopAgent()
        {
            try
            {
                if (agent != null && !agent.HasExited)
                {
                    agent.Kill();
                    agent.WaitForExit(3000);
                }
            }
            catch { }
        }

        // ── привилегированный помощник ───────────────────────────────────────────
        private const string SettingsPath = @"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        private const string MachineSettingsPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings";
        private const string ProxyOverrideValue =
            "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

        private static string ArgValue(string[] args, string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        private static void ElevatedLog(string message)
        {
            try
            {
                var dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "proxy-elevated.log"), DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        /// Починить права на ключ: администратору доступно, обычному пользователю — нет.
        private static void RepairKey(RegistryKey hive, string path)
        {
            try
            {
                using (var key = hive.OpenSubKey(path, RegistryKeyPermissionCheck.ReadWriteSubTree, RegistryRights.ChangePermissions))
                {
                    if (key == null) return;
                    var acl = key.GetAccessControl();
                    var me = WindowsIdentity.GetCurrent().Name;
                    acl.AddAccessRule(
                        new RegistryAccessRule(
                            me,
                            RegistryRights.FullControl,
                            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                            PropagationFlags.None,
                            AccessControlType.Allow));
                    key.SetAccessControl(acl);
                    ElevatedLog("права выданы: " + path);
                }
            }
            catch (Exception ex)
            {
                ElevatedLog("права " + path + " не изменены: " + ex.Message);
            }
        }

        private static void WriteMachineProxy(int proxyPort)
        {
            try
            {
                using (var key = Registry.LocalMachine.CreateSubKey(MachineSettingsPath, RegistryKeyPermissionCheck.ReadWriteSubTree))
                {
                    key.SetValue("ProxyEnable", 1, RegistryValueKind.DWord);
                    key.SetValue("ProxyServer", "127.0.0.1:" + proxyPort, RegistryValueKind.String);
                    key.SetValue("ProxyOverride", ProxyOverrideValue, RegistryValueKind.String);
                    ElevatedLog("записано в HKLM");
                }
            }
            catch (Exception ex)
            {
                ElevatedLog("HKLM не изменён: " + ex.Message);
            }
        }

        [DllImport("wininet.dll", SetLastError = true)]
        private static extern bool InternetSetOption(IntPtr hInternet, int option, IntPtr buffer, int length);

        private static void RefreshWinInetCs()
        {
            try
            {
                InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0); // SETTINGS_CHANGED
                InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0); // REFRESH
            }
            catch { }
        }

        private const string UserKey = @"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        private const string MachineKey = @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings";

        /// Записать значение через reg.exe: не зависит от .NET-разрешений процесса.
        private static bool RegWrite(string key, string name, string type, string value)
        {
            var args = "add \"" + key + "\" /v " + name + " /t " + type + " /d \"" + value + "\" /f";
            try
            {
                var psi = new ProcessStartInfo("reg.exe", args)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                using (var p = Process.Start(psi))
                {
                    var err = p.StandardError.ReadToEnd();
                    p.WaitForExit(10000);
                    if (p.ExitCode == 0)
                    {
                        ElevatedLog("reg " + name + " → ок");
                        return true;
                    }
                    ElevatedLog("reg " + name + " → " + (err.Trim().Length > 0 ? err.Trim() : "код " + p.ExitCode));
                    return false;
                }
            }
            catch (Exception ex)
            {
                ElevatedLog("reg " + name + " → " + ex.Message);
                return false;
            }
        }

        private static void RegDelete(string key, string name)
        {
            try
            {
                var psi = new ProcessStartInfo("reg.exe", "delete \"" + key + "\" /v " + name + " /f")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit(10000);
                }
            }
            catch { }
        }

        /// Включение/возврат системного прокси с правами администратора.
        private static int ElevatedProxy(string[] args)
        {
            var enable = Array.IndexOf(args, "enable") >= 0;
            var restore = Array.IndexOf(args, "restore") >= 0;
            int proxyPort;
            if (!int.TryParse(ArgValue(args, "--port") ?? "8180", out proxyPort)) proxyPort = 8180;
            var server = "127.0.0.1:" + proxyPort;

            ElevatedLog("старт: пользователь=" + WindowsIdentity.GetCurrent().Name + ", admin=" + IsElevated());

            if (enable)
            {
                // 1) если ACL ключа испорчен — пробуем вернуть права (лучшее усилие)
                RepairKey(Registry.CurrentUser, SettingsPath);
                RepairKey(Registry.LocalMachine, MachineSettingsPath);

                // 2) пишем через reg.exe
                var userOk =
                    RegWrite(UserKey, "ProxyEnable", "REG_DWORD", "1") &&
                    RegWrite(UserKey, "ProxyServer", "REG_SZ", server) &&
                    RegWrite(UserKey, "ProxyOverride", "REG_SZ", ProxyOverrideValue);
                if (!userOk)
                {
                    var machineOk =
                        RegWrite(MachineKey, "ProxyEnable", "REG_DWORD", "1") &&
                        RegWrite(MachineKey, "ProxyServer", "REG_SZ", server) &&
                        RegWrite(MachineKey, "ProxyOverride", "REG_SZ", ProxyOverrideValue);
                    if (!machineOk)
                    {
                        ElevatedLog("не удалось записать прокси ни в HKCU, ни в HKLM");
                        return 1;
                    }
                }
                RefreshWinInetCs();
                ElevatedLog("прокси включён");
                return 0;
            }

            if (restore)
            {
                var enabled = ArgValue(args, "--enabled") == "1";
                var oldServer = ArgValue(args, "--server") ?? string.Empty;
                var oldOverride = ArgValue(args, "--override") ?? string.Empty;
                RegWrite(UserKey, "ProxyEnable", "REG_DWORD", enabled ? "1" : "0");
                if (oldServer.Length > 0) RegWrite(UserKey, "ProxyServer", "REG_SZ", oldServer);
                else RegDelete(UserKey, "ProxyServer");
                if (oldOverride.Length > 0) RegWrite(UserKey, "ProxyOverride", "REG_SZ", oldOverride);
                else RegDelete(UserKey, "ProxyOverride");
                RefreshWinInetCs();
                ElevatedLog("прокси возвращён: enabled=" + enabled);
                return 0;
            }

            return 2;
        }

        // ── Win32 ────────────────────────────────────────────────────────────────
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, IntPtr value, int size);

        /// Окно без системной шапки: тянется за края, скругляется, подгоняется под контент.
        private sealed class FramelessForm : Form
        {
            private const int WM_NCHITTEST = 0x0084;
            private const int HTCLIENT = 1, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
                HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;

            private const int ResizeBorder = 6;
            private const int CornerRadius = 12;

            private bool roundedByDwm;
            private int userHeight;

            /// Забыть ручную высоту: окно снова подстраивается под контент.
            public void ResetUserHeight()
            {
                userHeight = 0;
            }

            public FramelessForm()
            {
                FormBorderStyle = FormBorderStyle.None;
                Padding = new Padding(0);
                DoubleBuffered = true;
            }

            /// Подгоняем окно под содержимое, не вылезая за рабочую область экрана.
            public void FitToContent(int contentWidth, int contentHeight)
            {
                // contentWidth == 0 означает «ширину не менять» (так просит рабочий экран)
                if (WindowState != FormWindowState.Normal || contentHeight <= 0) return;
                var area = Screen.FromControl(this).WorkingArea;
                // ширина 0 — «не менять»: так просит рабочий экран, чтобы окно не росло
                var w = contentWidth > 0
                    ? Math.Min(Math.Max(contentWidth, 780), Math.Max(780, area.Width - 60))
                    : Width;
                var h = Math.Min(Math.Max(contentHeight, 320), Math.Max(320, area.Height - 60));
                // ручную высоту не навязываем: окно следует за содержимым
                if (w == Width && h == Height) return;
                // печатаем и запрошенный, и фактический размер: если WinForms обрежет, это видно
                WriteLog("окно под контент: " + w + "x" + h + " → " + Width + "x" + Height);
                var left = Left;
                var top = Top;
                if (w != Width) left = Math.Max(area.Left, Math.Min(left + (Width - w) / 2, area.Right - w));
                if (h != Height) top = Math.Max(area.Top, Math.Min(top, area.Bottom - h));
                SetBounds(left, top, w, h);
                ApplyCorners();
            }

            protected override void OnHandleCreated(EventArgs e)
            {
                base.OnHandleCreated(e);
                ApplyCorners();
            }

            protected override void OnResizeEnd(EventArgs e)
            {
                base.OnResizeEnd(e);
                userHeight = Height; // растянул сам — меньше уже не делаем
                ApplyCorners();
            }

            private void ApplyCorners()
            {
                if (IsDisposed || !IsHandleCreated) return;

                // DWM-скругление умеет только Windows 11 (build 22000+). На Windows 10
                // вызов может вернуть «успех», ничего не сделав, поэтому проверяем
                // версию явно — иначе окно остаётся с прямыми углами.
                var win11 = Environment.OSVersion.Version.Build >= 22000;
                if (win11 && !roundedByDwm)
                {
                    try
                    {
                        var pref = 2; // DWMWCP_ROUND
                        var ptr = Marshal.AllocHGlobal(sizeof(int));
                        Marshal.WriteInt32(ptr, pref);
                        var res = DwmSetWindowAttribute(Handle, 33, ptr, sizeof(int));
                        Marshal.FreeHGlobal(ptr);
                        if (res == 0)
                        {
                            roundedByDwm = true;
                            Invalidate();
                            return;
                        }
                    }
                    catch { }
                }

                // Резервный путь (Windows 10 или DWM не сработал): обрезаем окно
                // скруглённой областью. Края без сглаживания, но углы круглые.
                var scale = DeviceDpi > 0 ? DeviceDpi / 96.0 : 1.0;
                var diameter = (int)Math.Round(CornerRadius * scale) * 2;
                var rgn = CreateRoundRectRgn(0, 0, Width + 1, Height + 1, diameter, diameter);
                if (rgn != IntPtr.Zero) SetWindowRgn(Handle, rgn, true);
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
                {
                    var lp = m.LParam.ToInt64();
                    var x = (short)(lp & 0xFFFF);
                    var y = (short)((lp >> 16) & 0xFFFF);
                    var p = PointToClient(new Point(x, y));
                    var left = p.X <= ResizeBorder;
                    var right = p.X >= ClientSize.Width - ResizeBorder;
                    var top = p.Y <= ResizeBorder;
                    var bottom = p.Y >= ClientSize.Height - ResizeBorder;
                    if (left && top) { m.Result = (IntPtr)HTTOPLEFT; return; }
                    if (right && top) { m.Result = (IntPtr)HTTOPRIGHT; return; }
                    if (left && bottom) { m.Result = (IntPtr)HTBOTTOMLEFT; return; }
                    if (right && bottom) { m.Result = (IntPtr)HTBOTTOMRIGHT; return; }
                    if (left) { m.Result = (IntPtr)HTLEFT; return; }
                    if (right) { m.Result = (IntPtr)HTRIGHT; return; }
                    if (top) { m.Result = (IntPtr)HTTOP; return; }
                    if (bottom) { m.Result = (IntPtr)HTBOTTOM; return; }
                    m.Result = (IntPtr)HTCLIENT;
                    return;
                }
                base.WndProc(ref m);
            }
        }
    }
}
