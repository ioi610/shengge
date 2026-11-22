/** The video surface, inside both native and webpage fullscreen containers. */
export function playerSurface(video:HTMLVideoElement):HTMLElement {
 return (video.closest?.('#movie_player,.bpx-player-video-area,.bilibili-player-video-area')??video.parentElement??video) as HTMLElement;
}
export const nativeBottomControls='.ytp-chrome-bottom,yt-player-quick-action-buttons,.bpx-player-control-wrap,.bilibili-player-video-control';
export const nativeControlCSS=`
#movie_player[data-shengge-controls]:not(.ad-showing):not(.ad-interrupting) :is(.ytp-chrome-bottom,.ytp-gradient-bottom,.ytp-tooltip,yt-player-quick-action-buttons),
:is(.bpx-player-video-area,.bilibili-player-video-area)[data-shengge-controls] :is(.bpx-player-control-wrap,.bpx-player-shadow-progress-area,.bilibili-player-video-control){visibility:hidden!important;opacity:0!important;pointer-events:none!important;transition:none!important;}`;

// Reveal only an explicitly opened native menu, never the rest of the hidden bottom bar.
export const nativeMenuCSS=`
#movie_player[data-shengge-controls] .ytp-settings-menu:not([data-shengge-native-menu]){visibility:hidden!important;opacity:0!important;pointer-events:none!important;}
[data-shengge-controls] .bpx-player-control-wrap[data-shengge-menu-ancestor],[data-shengge-controls] [data-shengge-menu-ancestor]{opacity:1!important;transform:none!important;overflow:visible!important;}
[data-shengge-controls] .bpx-player-control-wrap *{visibility:hidden!important;}
[data-shengge-controls] [data-shengge-native-menu]{position:fixed!important;inset:auto!important;left:var(--sg-native-left,0px)!important;top:var(--sg-native-top,0px)!important;max-height:var(--sg-native-height,300px)!important;max-width:var(--sg-native-width,400px)!important;min-height:0!important;overflow:auto!important;display:block!important;opacity:1!important;transform:none!important;margin:0!important;z-index:100!important;background:rgba(28,28,28,.96)!important;color:#fff!important;border-radius:8px!important;box-shadow:0 4px 20px #0006!important;}
[data-shengge-controls] [data-shengge-native-menu],[data-shengge-controls] [data-shengge-native-menu] *{visibility:visible!important;}
[data-shengge-controls] [data-shengge-native-menu]{pointer-events:auto!important;}
`;
