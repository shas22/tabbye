import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  // Profiling builds are isolated from the normal unpacked extension and release ZIP.
  outDir: process.env.WXT_PROFILE === 'true' ? '.output/profile' : '.output',
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'Tabbye',
    description:
      'Bye, tabs. Not your links. Automatically archive inactive tabs and keep their links on your device.',
    minimum_chrome_version: '121',
    permissions: ['tabs', 'storage', 'alarms'],
    incognito: 'not_allowed',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: { default_title: 'Tabbye' },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+T' } },
    },
  },
});
