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
bare_pipe_acl__token_user(HANDLE token, TOKEN_USER **result) {
  DWORD len = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &len);

  DWORD error = GetLastError();
  if (error != ERROR_INSUFFICIENT_BUFFER) return uv_translate_sys_error(error);

  TOKEN_USER *user = malloc(len);
  if (user == NULL) return UV_ENOMEM;

  if (!GetTokenInformation(token, TokenUser, user, len, &len)) {
    error = GetLastError();

    free(user);

    return uv_translate_sys_error(error);
  }

  *result = user;

  return 0;
}

static int
bare_pipe_acl__token_sid(HANDLE token, char **result) {
  TOKEN_USER *user;
  int err = bare_pipe_acl__token_user(token, &user);
  if (err < 0) return err;

  if (!ConvertSidToStringSidA(user->User.Sid, result)) err = uv_translate_sys_error(GetLastError());

  free(user);

  return err;
}

static int
bare_pipe_acl__token_integrity(HANDLE token, DWORD *result) {
  DWORD len = 0;
  GetTokenInformation(token, TokenIntegrityLevel, NULL, 0, &len);

  DWORD error = GetLastError();
  if (error != ERROR_INSUFFICIENT_BUFFER) return uv_translate_sys_error(error);

  TOKEN_MANDATORY_LABEL *label = malloc(len);
  if (label == NULL) return UV_ENOMEM;

  int err = 0;

  if (!GetTokenInformation(token, TokenIntegrityLevel, label, len, &len)) {
    err = uv_translate_sys_error(GetLastError());
  } else {
    PSID sid = label->Label.Sid;

    *result = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
  }

  free(label);

  return err;
}

typedef struct {
  BYTE sid[SECURITY_MAX_SID_SIZE];
  DWORD integrity;
} bare_pipe_acl__process_t;

static uv_once_t bare_pipe_acl__current_guard = UV_ONCE_INIT;
static bare_pipe_acl__process_t bare_pipe_acl__current_process;
static int bare_pipe_acl__current_err;

static void
bare_pipe_acl__on_current_once(void) {
  HANDLE token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    bare_pipe_acl__current_err = uv_translate_sys_error(GetLastError());

    return;
  }

  TOKEN_USER *user;
  int err = bare_pipe_acl__token_user(token, &user);

  if (err == 0) {
    if (!CopySid(sizeof(bare_pipe_acl__current_process.sid), bare_pipe_acl__current_process.sid, user->User.Sid)) {
      err = uv_translate_sys_error(GetLastError());
    }

    free(user);
  }

  if (err == 0) err = bare_pipe_acl__token_integrity(token, &bare_pipe_acl__current_process.integrity);

  CloseHandle(token);

  bare_pipe_acl__current_err = err;
}

// The user and integrity level of a process are fixed for its lifetime, save
// for lowering the integrity level, which only makes the cached level stricter.
static int
bare_pipe_acl__current(const bare_pipe_acl__process_t **result) {
  uv_once(&bare_pipe_acl__current_guard, bare_pipe_acl__on_current_once);

  if (bare_pipe_acl__current_err < 0) return bare_pipe_acl__current_err;

  *result = &bare_pipe_acl__current_process;

  return 0;
}

static int
bare_pipe_acl__process_token(DWORD pid, uint64_t connected, HANDLE *result) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == NULL) return uv_translate_sys_error(GetLastError());

  int err = 0;

  FILETIME created, exited, kernel, user;

  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (bare_pipe_acl__filetime(&created) > connected) {
    // The peer was alive when the pipe connected, so a process created since
    // has reused its ID after it exited. A process created in the same tick as
    // the accept is let through, as the clock cannot tell it from the peer.
    err = UV_ESRCH;
  } else if (!OpenProcessToken(process, TOKEN_QUERY, result)) {
    err = uv_translate_sys_error(GetLastError());
  }

  CloseHandle(process);

  return err;
}

static int
bare_pipe_acl__process_sid(DWORD pid, uint64_t connected, char **result) {
  HANDLE token;
  int err = bare_pipe_acl__process_token(pid, connected, &token);
  if (err < 0) return err;

  err = bare_pipe_acl__token_sid(token, result);

  CloseHandle(token);

  return err;
}

// The kernel records the owner when the pipe is created, and a creator may only
// name a SID from its own token unless it holds SeRestorePrivilege, so the owner
// cannot be claimed by another user short of that privilege.
static int
bare_pipe_acl__owner_sid(HANDLE handle, char **result) {
  PSID owner;
  PSECURITY_DESCRIPTOR sd;

  DWORD error = GetSecurityInfo(handle, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &sd);
  if (error != ERROR_SUCCESS) return uv_translate_sys_error(error);

  int err = 0;

  if (!ConvertSidToStringSidA(owner, result)) err = uv_translate_sys_error(GetLastError());

  LocalFree(sd);

  return err;
}

static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  const bare_pipe_acl__process_t *current;
  int err = bare_pipe_acl__current(&current);
  if (err < 0) return err;

  char *sid;
  if (!ConvertSidToStringSidA((PSID) current->sid, &sid)) return uv_translate_sys_error(GetLastError());

  // Protected, so nothing is inherited: only the current user and SYSTEM are
  // allowed. Remote clients and clients below the integrity level of the
  // server are instead rejected as they are accepted.
  const char *format = "D:P(A;;GA;;;%s)(A;;GA;;;SY)";

  size_t len = snprintf(NULL, 0, format, sid) + 1 /* NULL */;

  char *sddl = malloc(len);

  if (sddl == NULL) {
    LocalFree(sid);

    return UV_ENOMEM;
  }

  snprintf(sddl, len, format, sid);

  LocalFree(sid);

  PSECURITY_DESCRIPTOR sd;
  BOOL ok = ConvertStringSecurityDescriptorToSecurityDescriptorA(sddl, SDDL_REVISION_1, &sd, NULL);
  DWORD error = GetLastError();

  free(sddl);

  if (!ok) return uv_translate_sys_error(error);

  BOOL present, defaulted;
  PACL dacl;
  if (!GetSecurityDescriptorDacl(sd, &present, &dacl, &defaulted)) {
    err = uv_translate_sys_error(GetLastError());
  } else {
    // The descriptor lives on the pipe, not the instance: libuv's own
    // uv_pipe_chmod() relies on the same handle to change every instance.
    error = SetSecurityInfo(handle->handle, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, NULL, NULL, dacl, NULL);

    if (error != ERROR_SUCCESS) err = uv_translate_sys_error(error);
  }

  LocalFree(sd);

  if (err < 0) return err;

  // The first instance exists from bind, and a client that opened it before
  // the DACL changed keeps its connection. Drop it before listen accepts it.
  if (!DisconnectNamedPipe(handle->handle)) {
    error = GetLastError();

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

// Stands in for PIPE_REJECT_REMOTE_CLIENTS, which libuv does not set, and for a
// mandatory label, which libuv opens the pipe without the rights to set. An
// unlabeled pipe admits processes of the current user at a lower integrity
// level, such as the unelevated half of an elevated administrator. The DACL is
// also checked against the token the client connected with, which may be one
// it impersonated, so the user of the client process is checked as well. A
// client whose token cannot be queried is rejected, as a process may deny
// access to its own token.
static int
bare_pipe_acl_is_owner_client(uv_pipe_t *client, uint64_t connected, bool *result) {
  HANDLE handle = client->handle;

  int err = bare_pipe_acl__is_local_client(handle, result);
  if (err < 0 || !*result) return err;

  const bare_pipe_acl__process_t *current;
  err = bare_pipe_acl__current(&current);
  if (err < 0) return err;

  ULONG pid;
  if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

  HANDLE token;
  err = bare_pipe_acl__process_token(pid, connected, &token);
  if (err < 0) return err;

  TOKEN_USER *user;
  err = bare_pipe_acl__token_user(token, &user);

  if (err < 0) {
    CloseHandle(token);

    return err;
  }

  DWORD level;
  err = bare_pipe_acl__token_integrity(token, &level);

  CloseHandle(token);

  if (err == 0) {
    PSID sid = user->User.Sid;

    *result = (EqualSid(sid, (PSID) current->sid) || IsWellKnownSid(sid, WinLocalSystemSid)) && level >= current->integrity;
  }

  free(user);

  return err;
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

// A connection time of 0 means that it is unknown.
static int
bare_pipe_acl_peer_credentials(uv_pipe_t *pipe, uint64_t connected, bare_pipe_acl_credentials_t *result) {
  HANDLE handle = pipe->handle;

  DWORD flags;
  if (!GetNamedPipeInfo(handle, &flags, NULL, NULL, NULL)) return uv_translate_sys_error(GetLastError());

  ULONG pid;
  bool local;

  // A remote peer's process ID names a process on another machine, so it is
  // never reported, and neither is anything derived from it.
  if (flags & PIPE_SERVER_END) {
    int err = bare_pipe_acl__is_local_client(handle, &local);
    if (err < 0) return err;

    if (!local) return 0;

    // The process ID is fixed when the client opens the pipe, so a client can
    // hand its end to another process and exit to have its ID reused. Only a
    // remote client can name another ID outright, and is never asked. See
    // https://projectzero.google/2019/09/windows-exploitation-tricks-spoofing.html
    if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

    result->pid = pid;

    // Without knowing when the pipe connected, a process that reused the ID of
    // a peer that exited cannot be told apart from the peer.
    if (connected == 0) return 0;

    // A peer whose token the caller may not query, such as an elevated process
    // seen from an unelevated one, or whose ID has been reused, reports no SID
    // rather than failing.
    if (bare_pipe_acl__process_sid(pid, connected, &result->sid) < 0) result->sid = NULL;
  } else {
    int err = bare_pipe_acl__is_local_server(handle, &local);
    if (err < 0) return err;

    if (!local) return 0;

    if (!GetNamedPipeServerProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());

    result->pid = pid;

    // The server's process ID names the process that created the instance,
    // which need not be alive, so its ID may have been reused by the time the
    // client connects. The owner of the pipe identifies the server instead.
    if (bare_pipe_acl__owner_sid(handle, &result->sid) < 0) result->sid = NULL;
  }

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {
  if (credentials->sid != NULL) LocalFree(credentials->sid);
}

#endif // BARE_PIPE_ACL_WIN32_H
