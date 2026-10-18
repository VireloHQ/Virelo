# Library storage

The current directory, or folders passed with `--media`, are temporary for the
current server run. They do not become permanently active simply by starting Virelo.

Folders added in Settings → Libraries are saved libraries. They remain available
when the server is started from another folder using the same data directory.
Use **Save library** to promote a temporary folder.

On the server PC, open Virelo using its localhost address and use **Browse** to
select a folder in the system folder chooser. Confirm the path with **Add folder**.
When connecting from another device or through a proxy, Browse is disabled: enter
the folder's path on the server PC instead. Manual entry also works on headless
servers; Linux desktop browsing requires Zenity or KDialog.

Each account's library allowlist applies to both saved and active temporary
libraries. Account Manager lists the active catalog, including libraries outside
the administrator's own browsing allowlist; administrators manage server-wide access.
Only administrators can view the collapsed **Previously used folders** list.

For overlapping folders, media belongs to the most specific active library.
Scanning a parent cannot move that media out of a nested library's access rules.

## Existing installations

Older databases did not record whether a folder was added manually or at startup.
Those entries are retained as previous folders. The current startup folders remain
active; save any other previous folder to restore it across future starts.
Migration does not remove videos, indexed media, accounts, favorites or watch history.

Windows paths differing only in letter case resolve to one library. Existing
aliases are merged transactionally, retaining media IDs and account grants.
Removing a library deactivates it without deleting its index or personal state.
Saving the same folder restores it. A complete scan can still remove records for
files that were actually deleted; incomplete or unavailable-folder scans do not.

Libraries are shared server configuration, not separate filesystem sandboxes.
Grant folder-management permission only to trusted users who may access folders
readable by the server process.
