#ifndef BARE_PIPE_ACL_LINUX_H
#define BARE_PIPE_ACL_LINUX_H

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#include <uv.h>

#include "credentials.h"
#include "unix.h"

// Opened without following a symbolic link that replaced the socket, and
// changed through /proc as Linux cannot change the mode of an O_PATH
// descriptor directly.
static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  int fd = open(path, O_PATH | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return uv_translate_sys_error(errno);

  int err = 0;

  struct stat st;

  if (fstat(fd, &st) != 0) {
    err = uv_translate_sys_error(errno);
  } else if (!S_ISSOCK(st.st_mode)) {
    err = UV_ENOTSOCK;
  } else {
    char proc[32];
    snprintf(proc, sizeof(proc), "/proc/self/fd/%d", fd);

    if (chmod(proc, S_IRUSR | S_IWUSR) != 0) err = uv_translate_sys_error(errno);
  }

  close(fd);

  return err;
}

static int
bare_pipe_acl_peer_credentials(uv_pipe_t *handle, uint64_t connected, bare_pipe_acl_credentials_t *result) {
  uv_os_fd_t fd;
  int err = uv_fileno((uv_handle_t *) handle, &fd);
  if (err < 0) return err;

  struct ucred cred;
  socklen_t len = sizeof(cred);

  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return uv_translate_sys_error(errno);

  // A peer in a PID namespace that is not visible reports a process ID of 0,
  // and an unconnected socket reports -1 for its user and group IDs.
  if (cred.pid > 0) result->pid = cred.pid;
  if (cred.uid != (uid_t) -1) result->uid = cred.uid;
  if (cred.gid != (gid_t) -1) result->gid = cred.gid;

  return 0;
}

#endif // BARE_PIPE_ACL_LINUX_H
