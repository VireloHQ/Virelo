# Live TV

Open **Live TV** in the desktop header or sidebar, or from **Library** on a phone. Add an M3U or M3U8 playlist from an HTTPS link, a file, or pasted text. Search or filter the channel list and select a channel. Live TV uses the usual Virelo playback, volume, and fullscreen controls, without the on-demand seek and queue controls. Virelo does not include streams or check every channel when you import a playlist.

For a single HLS stream, add its HTTPS link. For a channel list imported from a file or pasted text, channel URLs must be absolute. Relative channel URLs in a remote list are resolved against that list's URL.

Choose **Check channels** to check the entire playlist or the current filtered results, including channels behind **Load more**. Click the result at the end of a row to check just that channel. Checks run a few at a time and show progress; you can cancel and continue with the remaining channels on the same page. Use the tag icon for **Channel group** and the broadcast icon for **Stream status** to filter the guide.

The displayed milliseconds measure the response to an HLS playlist request, not when playback starts. An accessible playlist does not guarantee its segments will play. If the browser cannot read a response, it shows **Could not confirm**.

- **Web:** Your playlists are saved in this browser. Connections go directly to the provider. The provider must allow browser access (CORS) for the playlist and HLS resources. Imported credentials in signed playlist links are kept out of library backups.
- **Self-hosted:** An administrator first opens **Allowed Live TV sources** and adds each trusted HTTPS origin, including separate origins serving variants or segments. Enter origins only, such as `https://streams.example.com`, without paths. The server relays only the approved public sources. Other users' playlists are not shared with you.

Live TV supports standard unencrypted HLS with MPEG-TS or fMP4 segments. It does not convert standalone transport streams, offer a channel catalog or programme guide, record broadcasts, or relay private-network endpoints. Use playlists you have permission to play.

The shared M3U parser is adapted from [Riyoway/iptv-player](https://github.com/Riyoway/iptv-player/tree/6aec6d858283e0574327f4fb4f444c1988606a35) under the MIT license. Virelo includes the original notice in both distributions.
