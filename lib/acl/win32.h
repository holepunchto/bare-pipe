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
bare_pipe_acl__token_sid(HANDLE token, char **result) {
  DWORD len = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &len);

  DWORD error = GetLastError();
  if (error != ERROR_INSUFFICIENT_BUFFER) return uv_translate_sys_error(error);

  TOKEN_USER *user = malloc(len);
  if (user == NULL) return UV_ENOMEM;

  int err = 0;

  if (!GetTokenInformation(token, TokenUser, user, len, &len)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (!ConvertSidToStringSidA(user->User.Sid, result)) {
    err = uv_translate_sys_error(GetLastError());
  }

  free(user);

  return err;
}

static int
bare_pipe_acl__process_sid(DWORD pid, uint64_t connected, char **result) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == NULL) return uv_translate_sys_error(GetLastError());

  int err = 0;

  FILETIME created, exited, kernel, user;
  HANDLE token = NULL;

  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (bare_pipe_acl__filetime(&created) >= connected) {
    // The peer was alive when the pipe connected, so a process created since
    // has reused its ID after it exited.
    err = UV_ESRCH;
  } else if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    err = uv_translate_sys_error(GetLastError());
  }

  CloseHandle(process);

  if (err < 0) return err;

  err = bare_pipe_acl__token_sid(token, result);

  CloseHandle(token);

  return err;
}

static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  HANDLE token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    return uv_translate_sys_error(GetLastError());
  }

  char *sid;
  int err = bare_pipe_acl__token_sid(token, &sid);

  CloseHandle(token);

  if (err < 0) return err;

  // Protected, so nothing is inherited: the current user and SYSTEM are
  // allowed, and network logons are denied even for the current user, which
  // stands in for PIPE_REJECT_REMOTE_CLIENTS that libuv does not set.
  const char *format = "D:P(D;;GA;;;NU)(A;;GA;;;%s)(A;;GA;;;SY)";

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

// Asks the handle rather than the name it was opened by, as Win32 resolves a
// name such as \\.\pipe\..\UNC\host\pipe\name to a pipe on another machine.
static int
bare_pipe_acl__is_local_pipe(HANDLE handle, bool *result) {
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

  // A remote peer's process ID names a process on another machine, so it is
  // never reported, and neither is anything derived from it.
  if (flags & PIPE_SERVER_END) {
    WCHAR host[DNS_MAX_NAME_BUFFER_LENGTH];
    if (GetNamedPipeClientComputerNameW(handle, host, sizeof(host))) return 0;

    DWORD error = GetLastError();
    if (error != ERROR_PIPE_LOCAL) return uv_translate_sys_error(error);

    if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());
  } else {
    bool local;
    int err = bare_pipe_acl__is_local_pipe(handle, &local);
    if (err < 0) return err;

    if (!local) return 0;

    if (!GetNamedPipeServerProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());
  }

  result->pid = pid;

  // Without knowing when the pipe connected, a process that reused the ID of a
  // peer that exited cannot be told apart from the peer.
  if (connected == 0) return 0;

  // A peer whose token the caller may not query, such as an elevated process
  // seen from an unelevated one, or whose ID has been reused, reports no SID
  // rather than failing.
  if (bare_pipe_acl__process_sid(pid, connected, &result->sid) < 0) result->sid = NULL;

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {
  if (credentials->sid != NULL) LocalFree(credentials->sid);
}

#endif // BARE_PIPE_ACL_WIN32_H
