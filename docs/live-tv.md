# Live TV

Open **Live TV** in the desktop header or sidebar, or from **Library** on a phone. Select **Add playlist** to reveal the form below the button on desktop, or open it in a dialog on a phone. Add an M3U or M3U8 playlist from an HTTPS link, a file, or pasted text. Search or filter the channel list and select a channel. Live TV uses the usual Virelo playback, volume, and fullscreen controls, without queue controls. Virelo does not include streams.

The player shows a progress bar for every stream. On-demand streams use their normal timeline. The live bar is full when you are watching live, and shows your position if you rewind. If the stream does not offer seeking, the bar is full but disabled.

While a channel plays, browse to another page to keep it playing in the miniplayer. Select **Expand player** to return to the guide or **Close miniplayer** to stop the stream.

Drag the picture to move it; it snaps to the nearest corner. The title and timeline stay visible. Hover, tap, or focus the picture to reveal the controls in your selected player style. Use the arrow keys on the focused picture to choose a corner, or focus the timeline to seek when supported.

For a single HLS stream, choose **Add playlist → Stream link**, enter its HTTPS URL (for example, a link ending in `.m3u8`), and select **Add stream**. The stream appears as one channel and its connection is checked in the background. Use the hosted URL for an HLS manifest, not a local copy of the file. For a channel list imported from a file or pasted text, channel URLs must be absolute. Relative channel URLs in a remote list are resolved against that list's URL.

Virelo starts checking channel links in the background after you add a playlist. Checks run a few at a time, including channels behind **Load more**, without opening the player. Use the stop button to cancel; the pulse button lets you continue with unchecked channels or recheck the current filtered results. Click the result at the end of a row to check just that channel.

Results are saved per playlist in your browser or self-hosted account. Opening a saved playlist does not check it again. **Last checked** shows the most recent completed check, which might cover only one channel. Filter by **Channel group** (tag icon) or **Stream status** (broadcast icon). Both menus use the guide width and show icons beside their options. Active filters are highlighted.

The displayed milliseconds measure the response to an HLS playlist request, not when playback starts. An accessible playlist does not guarantee its segments will play. If the browser cannot read a response, it shows **Could not confirm**.

- **Web:** Your playlists are saved in this browser. Connections go directly to the provider. Native HLS playback can work even if the background check reports **Could not confirm**. Importing a remote channel list, checking a channel, and playing through the JavaScript HLS player require the provider to allow browser access (CORS). Imported credentials in signed playlist links are kept out of library backups.
- **Self-hosted:** An administrator first opens **Allowed Live TV sources** and adds each trusted HTTPS origin, including separate origins serving variants or segments. Enter origins only, such as `https://streams.example.com`, without paths. The server relays only the approved public sources. Other users' playlists are not shared with you.

Live TV supports standard unencrypted HLS with MPEG-TS or fMP4 segments. It does not convert standalone transport streams, offer a channel catalog or programme guide, record broadcasts, or relay private-network endpoints. Use playlists you have permission to play.

The shared M3U parser is adapted from [Riyoway/iptv-player](https://github.com/Riyoway/iptv-player/tree/6aec6d858283e0574327f4fb4f444c1988606a35) under the MIT license. Virelo includes the original notice in both distributions.
