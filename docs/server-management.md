# Server management

The `npx virelo` command starts a Virelo server. It does **not** automatically scan the directory where you run it.

## Start and attach

On an interactive terminal:

```bash
npx virelo
```

Virelo starts the background server (or finds the existing one for the same data directory) and opens the terminal management console. The sidebar provides Overview, Libraries, Live logs and Settings. Use the mouse or arrow keys and Enter; **Tab** switches between navigation and the content panel. **O** opens the Web UI, **Q** or **Ctrl+C** returns to the shell without stopping Virelo, and **X** asks to stop the server. **Close console** does not close the terminal window. Closing the terminal does not stop a background-managed server.

The terminal console includes server status, library actions, scan status, recent logs and basic settings. You can reconnect from any directory by running `npx virelo` again. Changes made in the Web UI persist between runs.

### Port settings

In **Settings**, select the saved port and press Enter (or click it). Enter a port from 0 to 65535; **0** selects an available port automatically. Save the port, then choose **Restart server** to apply it. The console checks for an occupied port before requesting a restart and reconnects only after the new process is ready. Port changes retain any pending bind address from Web Admin. Temporary folders are carried over when a managed server restarts. A server run by Docker or another service manager must be restarted through that manager.

### Live logs

**Live logs** follows local server output while the panel is open. **Space** pauses/resumes following; arrows, Page Up/Page Down, Home/End and the mouse wheel browse the buffer. Use **All levels** to filter warnings/errors and **Search** (or `/`) to find text. Reads are bounded to the latest 64 KiB and the display retains up to 1,000 entries. Pausing only affects the view; it does not change server logging. The console never edits the log file.

Overview and Settings use compact panels; folders and logs expand to use the available terminal height. The layout adapts to narrow terminals, preserves Unicode folder names, honors `NO_COLOR` and restores the shell when closed. Pipes and `TERM=dumb` keep plain status output instead of opening a full-screen UI.

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

The local control socket authenticates both endpoints with a profile-specific secret that stays on disk. Unix sockets and credentials are restricted to the user account. Do not put the data directory in a publicly writable or shared location.

## Web Admin

An administrator can open **Settings → Server** to view the active server and adjust the desired host and port. Saving a network change does not expose the current server to other devices immediately: the new address takes effect after a restart. Network changes and server stop/restart controls are restricted to localhost. Admin accounts do not grant arbitrary local process control to remote viewers.

After a managed restart, Web Admin reconnects when the same Virelo profile is ready at the saved fixed address. With port 0, find the new address in the console or with `npx virelo status`. If the hostname changed, sign in again. Stopping or restarting ends any active playback connections.

A server started by a container or an external service manager may not be restartable from the Web Admin. Use that service manager instead.

## Docker, SSH and scripts

In Docker and noninteractive shells, Virelo runs in the **foreground** by default; it logs to stdout/stderr and responds to termination signals. Prefer a Docker restart policy if you want the container restarted automatically. Do **not** run the server as an independent daemon inside the container.

For Docker administration, connect interactively to the **running** instance with `docker exec -it ... npx virelo`. This opens the TUI without starting a second server. Ensure the container sees the same `--data` profile.

In an interactive SSH session, the terminal console works normally and can detach from the running server. When terminal capabilities are limited, the interface falls back to plain status output. Noninteractive SSH sessions and scripts can use `--background` to start a detached server explicitly, or `--foreground` when managed by systemd, launchd or another supervisor.

## Migration from older CLI versions

Stop the previous Virelo process before updating. Earlier versions automatically scanned the current directory. The first interactive launch with an existing data directory explains the new behavior and how to use `--here`. Saved libraries remain unchanged. New installations skip this migration warning.

**OS sign-in autostart is not yet part of this change.** It needs a durable install location and OS-specific service registration. Do not register an `npx` cache path as an OS login service.
