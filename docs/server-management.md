# Server management

The `npx virelo` command starts a Virelo server. It does **not** automatically scan the directory where you run it.

## Start and attach

On an interactive terminal:

```bash
npx virelo
```

Virelo starts the background server (or finds the existing one for the same data directory) and opens the terminal management console. Select actions using the arrow keys and Enter; **O** opens the Web UI, **Q** closes only the console, and **X** asks to stop the server. Closing the terminal does not stop a background-managed server.

The terminal console includes server status, library actions, scan status, recent logs and basic settings. You can reconnect from any directory by running `npx virelo` again. Changes made in the Web UI persist between runs.

```bash
npx virelo --here             # Include the current directory for this run
npx virelo --media ~/Videos   # Include a different directory
npx virelo --background       # Start without opening a terminal UI
npx virelo status             # Is the server running?
npx virelo restart            # Restart a managed server
npx virelo stop               # Stop a managed server
```

Adding media with `--here` or `--media` makes it available for the current run. Use **Settings → Libraries** in the Web UI to save a folder permanently. Previously saved libraries are loaded normally.

## Server profiles

By default, data is stored in `~/.virelo`. Use `--data <path>` to select an independent profile. Each profile has its own library database and local control socket, so `npx virelo --data <path>` attaches only to that profile.

The local control socket uses a profile-specific secret. Unix sockets and credentials are restricted to the user account. Do not put the data directory in a publicly writable or shared location.

## Web Admin

An administrator can open **Settings → Server** to view the active server and adjust the desired host and port. Saving a network change does not expose the current server to other devices immediately: the new address takes effect after a restart. Network changes and server stop/restart controls are restricted to localhost. Admin accounts do not grant arbitrary local process control to remote viewers.

A server started by a container or an external service manager may not be restartable from the Web Admin. Use that service manager instead.

## Docker, SSH and scripts

In Docker and noninteractive shells, Virelo runs in the **foreground** by default; it logs to stdout/stderr and responds to termination signals. Prefer a Docker restart policy if you want the container restarted automatically. Do **not** run the server as an independent daemon inside the container.

For Docker administration, connect interactively to the **running** instance with `docker exec -it ... npx virelo`. This opens the TUI without starting a second server. Ensure the container sees the same `--data` profile.

In an interactive SSH session, the terminal console works normally and can detach from the running server. When terminal capabilities are limited, the interface falls back to plain status output. Noninteractive SSH sessions and scripts can use `--background` to start a detached server explicitly, or `--foreground` when managed by systemd, launchd or another supervisor.

## Migration from older CLI versions

Earlier versions automatically scanned the current directory. The first interactive launch with an existing data directory explains the new behavior and how to use `--here`. Saved libraries remain unchanged. New installations skip this migration warning.

**OS sign-in autostart is not yet part of this change.** It needs a durable install location and OS-specific service registration. Do not register an `npx` cache path as an OS login service.
