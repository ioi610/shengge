export const PROTOCOL = 1;
export const BUILD_VERSION = '__BUILD_VERSION__';
export const EXTENSION_ID = '__EXTENSION_ID__';
export const APP_NAME = '声格';
export const ADAPTER_VERSION = 'youtube-bilibili-0.1';

declare const __SHENGGE_DESKTOP__:boolean;
export const desktopTraining=typeof __SHENGGE_DESKTOP__!=='undefined' && __SHENGGE_DESKTOP__;
