/*
 * Component docs page: the order of the Storybook autodocs blocks, with the Variants block before the other
 * stories, as in the component frame in Figma: description, the set matrix, examples below.
 */

import { Controls, Description, Primary, Stories, Subtitle, Title } from '@storybook/addon-docs/blocks'
import type { IStoryframeConfig } from '../config.ts'
import { Variants } from './variants.tsx'

/**
 * Docs page for `parameters.docs.page` with the Variants block according to the project configuration.
 * @param config the project's storyframe configuration (`storyframe.config.ts`)
 */
export function createDocsPage(config?: IStoryframeConfig) {
  return function StoryframeDocsPage() {
    return (
      <>
        <Title />
        <Subtitle />
        <Description />
        <Primary />
        <Controls />
        <Variants config={config} />
        <Stories />
      </>
    )
  }
}
