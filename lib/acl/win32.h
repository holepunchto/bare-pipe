#ifndef BARE_PIPE_ACL_WIN32_H
#define BARE_PIPE_ACL_WIN32_H

#include <aclapi.h>
#include <sddl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <uv.h>
#include <windns.h>
#include <winioctl.h>
#include <winternl.h>

#include "credentials.h"

typedef struct {
  DEVICE_TYPE DeviceType;
  ULONG Characteristics;
} bare_pipe_acl__fs_device_information_t;

enum {
  bare_pipe_acl__fs_device_information = 4,
  bare_pipe_acl__remote_device = 0x10,
};

// Declared by the MinGW headers, but only by the DDK for MSVC.
#ifndef __MINGW32__
NTSYSAPI NTSTATUS NTAPI
NtQueryVolumeInformationFile(HANDLE FileHandle, PIO_STATUS_BLOCK IoStatusBlock, PVOID FsInformation, ULONG Length, ULONG FsInformationClass);
#endif

typedef struct {
  BYTE sid[SECURITY_MAX_SID_SIZE];
  DWORD integrity;
} bare_pipe_acl__process_t;

static inline uint64_t
bare_pipe_acl__filetime(const FILETIME *time) {
  return ((uint64_t) time->dwHighDateTime << 32) | time->dwLowDateTime;
}

// The coarse clock, as process creation times are taken from it.
static inline uint64_t
bare_pipe_acl_timestamp(void) {
  FILETIME now;
  GetSystemTimeAsFileTime(&now);

  return bare_pipe_acl__filetime(&now);
}

static int
bare_pipe_acl__sid_string(PSID sid, char **result) {
  char *string;
  if (!ConvertSidToStringSidA(sid, &string)) return uv_translate_sys_error(GetLastError());

  *result = string;

  return 0;
}

static int
bare_pipe_acl__token_information(HANDLE token, TOKEN_INFORMATION_CLASS type, void **result) {
  DWORD len = 0;
  GetTokenInformation(token, type, NULL, 0, &len);

  DWORD error = GetLastError();
  if (error != ERROR_INSUFFICIENT_BUFFER) return uv_translate_sys_error(error);

  void *info = malloc(len);
  if (info == NULL) return UV_ENOMEM;

  if (!GetTokenInformation(token, type, info, len, &len)) {
    error = GetLastError();

    free(info);

    return uv_translate_sys_error(error);
  }

  *result = info;

  return 0;
}

static int
bare_pipe_acl__process(HANDLE process, bare_pipe_acl__process_t *result) {
  HANDLE token;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return uv_translate_sys_error(GetLastError());

  TOKEN_USER *user = NULL;
  TOKEN_MANDATORY_LABEL *label = NULL;

  int err = bare_pipe_acl__token_information(token, TokenUser, (void **) &user);
  if (err == 0) err = bare_pipe_acl__token_information(token, TokenIntegrityLevel, (void **) &label);

  CloseHandle(token);

  if (err == 0 && !CopySid(sizeof(result->sid), result->sid, user->User.Sid)) {
    err = uv_translate_sys_error(GetLastError());
  }

  if (err == 0) {
    PSID sid = label->Label.Sid;

    result->integrity = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
  }

  free(user);
  free(label);

  return err;
}

static int
bare_pipe_acl__peer_process(DWORD pid, uint64_t connected, bare_pipe_acl__process_t *result) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == NULL) return uv_translate_sys_error(GetLastError());

  int err;
  FILETIME created, exited, kernel, user;

  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (bare_pipe_acl__filetime(&created) > connected) {
    // Created after the pipe connected, so it has reused the ID of a peer that
    // exited.
    err = UV_ESRCH;
  } else {
    err = bare_pipe_acl__process(process, result);
  }

  CloseHandle(process);

  return err;
}

static int
bare_pipe_acl__owner_sid(HANDLE handle, char **result) {
  PSID owner;
  PSECURITY_DESCRIPTOR sd;

  DWORD error = GetSecurityInfo(handle, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &sd);
  if (error != ERROR_SUCCESS) return uv_translate_sys_error(error);

  int err = bare_pipe_acl__sid_string(owner, result);

  LocalFree(sd);

  return err;
}

static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  bare_pipe_acl__process_t current;
  int err = bare_pipe_acl__process(GetCurrentProcess(), &current);
  if (err < 0) return err;

  char *sid;
  err = bare_pipe_acl__sid_string((PSID) current.sid, &sid);
  if (err < 0) return err;

  char sddl[256];
  snprintf(sddl, sizeof(sddl), "D:P(A;;GA;;;%s)(A;;GA;;;SY)", sid);

  LocalFree(sid);

  PSECURITY_DESCRIPTOR sd;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorA(sddl, SDDL_REVISION_1, &sd, NULL)) {
    return uv_translate_sys_error(GetLastError());
  }

  BOOL present, defaulted;
  PACL dacl;

  if (!GetSecurityDescriptorDacl(sd, &present, &dacl, &defaulted)) {
    err = uv_translate_sys_error(GetLastError());
  } else {
    // Applies to every instance of the pipe, as uv_pipe_chmod() relies on too.
    DWORD error = SetSecurityInfo(handle->handle, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, NULL, NULL, dacl, NULL);

    if (error != ERROR_SUCCESS) err = uv_translate_sys_error(error);
  }

  LocalFree(sd);

  if (err < 0) return err;

  // Drop a client that opened the first instance before the DACL changed.
  if (!DisconnectNamedPipe(handle->handle)) {
    DWORD error = GetLastError();

    if (error != ERROR_PIPE_NOT_CONNECTED) return uv_translate_sys_error(error);
  }

  return 0;
}

static int
bare_pipe_acl__is_local_client(HANDLE handle, bool *result) {
  WCHAR host[DNS_MAX_NAME_BUFFER_LENGTH];

  if (GetNamedPipeClientComputerNameW(handle, host, sizeof(host))) {
    *result = false;

    return 0;
  }

  DWORD error = GetLastError();
  if (error != ERROR_PIPE_LOCAL) return uv_translate_sys_error(error);

  *result = true;

  return 0;
}

// Asks the handle rather than the name it was opened by, as Win32 resolves a
// name such as \\.\pipe\..\UNC\host\pipe\name to a pipe on another machine.
static int
bare_pipe_acl__is_local_server(HANDLE handle, bool *result) {
  IO_STATUS_BLOCK status;
  bare_pipe_acl__fs_device_information_t info;

  NTSTATUS res = NtQueryVolumeInformationFile(handle, &status, &info, sizeof(info), bare_pipe_acl__fs_device_information);
  if (res < 0) return uv_translate_sys_error(RtlNtStatusToDosError(res));

  *result = info.DeviceType == FILE_DEVICE_NAMED_PIPE && (info.Characteristics & bare_pipe_acl__remote_device) == 0;

  return 0;
}

// Stands in for PIPE_REJECT_REMOTE_CLIENTS and a mandatory label, which libuv
// does not set, and for the DACL being checked against a token the client may
// have impersonated.
static int
bare_pipe_acl_is_owner_client(uv_pipe_t *client, uint64_t connected, bool *result) {
  HANDLE handle = client->handle;

  int err = bare_pipe_acl__is_local_client(handle, result);
  if (err < 0 || !*result) return err;

  ULONG pid;
  if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

  bare_pipe_acl__process_t current;
  err = bare_pipe_acl__process(GetCurrentProcess(), &current);
  if (err < 0) return err;

  bare_pipe_acl__process_t peer;
  err = bare_pipe_acl__peer_process(pid, connected, &peer);
  if (err < 0) return err;

  PSID sid = (PSID) peer.sid;

  *result = (EqualSid(sid, (PSID) current.sid) || IsWellKnownSid(sid, WinLocalSystemSid)) && peer.integrity >= current.integrity;

  return 0;
}

static int
bare_pipe_acl_peer_credentials(uv_pipe_t *pipe, uint64_t connected, bare_pipe_acl_credentials_t *result) {
  HANDLE handle = pipe->handle;

  DWORD flags;
  if (!GetNamedPipeInfo(handle, &flags, NULL, NULL, NULL)) return uv_translate_sys_error(GetLastError());

  ULONG pid;
  bool local;

  if (flags & PIPE_SERVER_END) {
    // Only a remote client can choose the process ID it reports.
    int err = bare_pipe_acl__is_local_client(handle, &local);
    if (err < 0 || !local) return err;

    if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

    bare_pipe_acl__process_t peer;

    // Without the time of the connection, a reused process ID goes unnoticed.
    if (connected != 0 && bare_pipe_acl__peer_process(pid, connected, &peer) == 0) {
      bare_pipe_acl__sid_string((PSID) peer.sid, &result->sid);
    }
  } else {
    int err = bare_pipe_acl__is_local_server(handle, &local);
    if (err < 0 || !local) return err;

    if (!GetNamedPipeServerProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

    bare_pipe_acl__owner_sid(handle, &result->sid);
  }

  result->pid = pid;

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {
  if (credentials->sid != NULL) LocalFree(credentials->sid);
}

#endif // BARE_PIPE_ACL_WIN32_H
