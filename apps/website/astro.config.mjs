import sitemap from '@astrojs/sitemap'
import { unified } from '@astrojs/markdown-remark'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'

import { remarkWebsiteLinks } from './remark-website-links.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  site: 'https://doxajs.com',
  integrations: [sitemap()],
  markdown: {
    processor: unified({
      remarkPlugins: [[remarkWebsiteLinks, { root: repositoryRoot }]],
    }),
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
