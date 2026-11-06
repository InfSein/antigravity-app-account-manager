param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [Parameter(Mandatory=$true)]
    [string]$Target,
    [string]$UserName = ""
)

$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not ([System.Management.Automation.PSTypeName]'WinCred').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    public static string ReadCred(string target) {
        IntPtr credPtr;
        if (CredRead(target, 1, 0, out credPtr)) {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, (int)cred.CredentialBlobSize);
            CredFree(credPtr);
            return Encoding.UTF8.GetString(blob);
        }
        return null;
    }

    public static bool WriteCred(string target, string userName, string secret) {
        byte[] blob = Encoding.UTF8.GetBytes(secret);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        Marshal.Copy(blob, 0, blobPtr, blob.Length);
        CREDENTIAL cred = new CREDENTIAL();
        cred.Type = 1; // CRED_TYPE_GENERIC
        cred.TargetName = target;
        cred.UserName = userName;
        cred.CredentialBlob = blobPtr;
        cred.CredentialBlobSize = (uint)blob.Length;
        cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE
        bool result = CredWrite(ref cred, 0);
        Marshal.FreeHGlobal(blobPtr);
        return result;
    }
}
'@
}

if ($Action -eq "read") {
    $val = [WinCred]::ReadCred($Target)
    if ($val) {
        [Console]::Out.Write($val)
    }
} elseif ($Action -eq "write") {
    $secret = [Console]::In.ReadToEnd()
    if ($secret) {
        $res = [WinCred]::WriteCred($Target, $UserName, $secret)
        [Console]::Out.Write($res.ToString())
    } else {
        [Console]::Out.Write("False")
    }
}
