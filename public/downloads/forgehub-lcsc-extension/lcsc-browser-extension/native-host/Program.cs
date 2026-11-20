using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class Program
{
    private const string ComponentEndpoint = "https://pro.lceda.cn/api/v2/components/";
    private const string StepEndpoint = "https://modules.lceda.cn/qAxj6KHrDKw4blvCG8QJPs7Y/";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
    private static readonly HttpClient Http = CreateHttpClient();

    private static HttpClient CreateHttpClient()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        return new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
    }

    private static int Main()
    {
        try
        {
            var input = Console.OpenStandardInput();
            var lengthBytes = ReadExact(input, 4);
            if (lengthBytes == null) return 0;
            var length = BitConverter.ToInt32(lengthBytes, 0);
            if (length < 1 || length > 1024 * 1024) throw new InvalidDataException("Invalid native-message size.");

            var payload = ReadExact(input, length);
            if (payload == null) throw new EndOfStreamException("Incomplete native message.");
            var request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(payload));
            var action = GetString(request, "action");
            Dictionary<string, object> response;

            if (action == "ping")
            {
                response = new Dictionary<string, object> { { "ok", true }, { "version", "1.0.0" } };
            }
            else if (action == "download")
            {
                response = DownloadAsync(GetString(request, "modelUuid"), GetString(request, "fileName")).GetAwaiter().GetResult();
            }
            else
            {
                response = new Dictionary<string, object> { { "ok", false }, { "error", "Unsupported request." } };
            }

            WriteResponse(response);
            return 0;
        }
        catch (Exception ex)
        {
            WriteResponse(new Dictionary<string, object> { { "ok", false }, { "error", FriendlyMessage(ex) } });
            return 0;
        }
    }

    private static async Task<Dictionary<string, object>> DownloadAsync(string modelUuid, string requestedName)
    {
        if (String.IsNullOrWhiteSpace(modelUuid) || modelUuid.Length > 100) throw new InvalidDataException("无效的 3D 模型编号");
        foreach (var ch in modelUuid) if (!Char.IsLetterOrDigit(ch) && ch != '_' && ch != '-') throw new InvalidDataException("无效的 3D 模型编号");

        var downloadableUuid = modelUuid;
        try
        {
            using (var componentRequest = new HttpRequestMessage(HttpMethod.Get, ComponentEndpoint + Uri.EscapeDataString(modelUuid)))
            {
                componentRequest.Headers.Accept.ParseAdd("application/json");
                using (var componentResponse = await Http.SendAsync(componentRequest, HttpCompletionOption.ResponseContentRead))
                {
                    if (componentResponse.IsSuccessStatusCode)
                    {
                        var json = await componentResponse.Content.ReadAsStringAsync();
                        var component = Json.DeserializeObject(json) as Dictionary<string, object>;
                        var result = GetValue(component, "result", "Result") as Dictionary<string, object>;
                        var resolved = GetString(result, "model3DUuid", "Model3DUuid", "3d_model_uuid", "3dModelUuid");
                        if (!String.IsNullOrWhiteSpace(resolved)) downloadableUuid = resolved;
                    }
                }
            }
        }
        catch
        {
            // Some search results already contain the downloadable model UUID.
        }

        using (var stepResponse = await Http.GetAsync(StepEndpoint + Uri.EscapeDataString(downloadableUuid), HttpCompletionOption.ResponseHeadersRead))
        {
            if (!stepResponse.IsSuccessStatusCode)
                throw new InvalidOperationException("立创文件服务返回 HTTP " + (int)stepResponse.StatusCode);

            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            Directory.CreateDirectory(downloads);
            var fileName = SafeFileName(requestedName);
            var filePath = UniquePath(downloads, fileName);

            try
            {
                using (var source = await stepResponse.Content.ReadAsStreamAsync())
                using (var target = new FileStream(filePath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    var first = new byte[512];
                    var firstLength = await source.ReadAsync(first, 0, first.Length);
                    var preview = Encoding.UTF8.GetString(first, 0, firstLength).TrimStart();
                    if (preview.StartsWith("<", StringComparison.Ordinal) || preview.StartsWith("{", StringComparison.Ordinal))
                    {
                        var codeStart = preview.IndexOf("<Code>", StringComparison.OrdinalIgnoreCase);
                        var codeEnd = codeStart >= 0 ? preview.IndexOf("</Code>", codeStart, StringComparison.OrdinalIgnoreCase) : -1;
                        var code = codeEnd > codeStart ? preview.Substring(codeStart + 6, codeEnd - codeStart - 6) : "";
                        throw new InvalidDataException(code == "AccessDenied"
                            ? "立创文件服务拒绝了本次请求（AccessDenied）"
                            : "立创文件服务没有返回 STEP 文件");
                    }
                    if (firstLength > 0) await target.WriteAsync(first, 0, firstLength);
                    var buffer = new byte[81920];
                    int read;
                    while ((read = await source.ReadAsync(buffer, 0, buffer.Length)) > 0)
                        await target.WriteAsync(buffer, 0, read);
                }
            }
            catch
            {
                if (File.Exists(filePath)) File.Delete(filePath);
                throw;
            }

            var info = new FileInfo(filePath);
            if (info.Length == 0)
            {
                File.Delete(filePath);
                throw new InvalidDataException("立创文件服务返回了空文件");
            }

            return new Dictionary<string, object> { { "ok", true }, { "fileName", Path.GetFileName(filePath) } };
        }
    }

    private static string SafeFileName(string value)
    {
        if (String.IsNullOrWhiteSpace(value)) value = "component";
        foreach (var invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
        value = value.Replace('/', '_').Replace('\\', '_').Trim().TrimEnd('.');
        if (value.Length > 120) value = value.Substring(0, 120);
        if (value.EndsWith(".step", StringComparison.OrdinalIgnoreCase)) value = value.Substring(0, value.Length - 5);
        return (String.IsNullOrWhiteSpace(value) ? "component" : value) + ".step";
    }

    private static string UniquePath(string folder, string fileName)
    {
        var candidate = Path.Combine(folder, fileName);
        if (!File.Exists(candidate)) return candidate;
        var stem = Path.GetFileNameWithoutExtension(fileName);
        for (var i = 1; i < 10000; i++)
        {
            candidate = Path.Combine(folder, stem + " (" + i + ").step");
            if (!File.Exists(candidate)) return candidate;
        }
        throw new IOException("下载目录中同名文件过多");
    }

    private static object GetValue(Dictionary<string, object> source, params string[] names)
    {
        if (source == null) return null;
        foreach (var name in names)
            foreach (var pair in source)
                if (String.Equals(pair.Key, name, StringComparison.OrdinalIgnoreCase)) return pair.Value;
        return null;
    }

    private static string GetString(Dictionary<string, object> source, params string[] names)
    {
        var value = GetValue(source, names);
        return value == null ? String.Empty : Convert.ToString(value);
    }

    private static byte[] ReadExact(Stream stream, int length)
    {
        var buffer = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var read = stream.Read(buffer, offset, length - offset);
            if (read == 0) return null;
            offset += read;
        }
        return buffer;
    }

    private static void WriteResponse(Dictionary<string, object> response)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(response));
            var output = Console.OpenStandardOutput();
            output.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
            output.Write(bytes, 0, bytes.Length);
            output.Flush();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
        }
    }

    private static string FriendlyMessage(Exception ex)
    {
        while (ex is AggregateException && ex.InnerException != null) ex = ex.InnerException;
        if (ex is TaskCanceledException) return "立创接口请求超时，请稍后重试";
        return ex.Message;
    }
}
