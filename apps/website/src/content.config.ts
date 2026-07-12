import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

const markdown = '**/*.md'

export const collections = {
  docs: defineCollection({
    loader: glob({ base: '../../docs', pattern: markdown }),
  }),
  manifesto: defineCollection({
    loader: glob({ base: '../../manifesto', pattern: markdown }),
  }),
}
