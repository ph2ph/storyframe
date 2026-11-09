/*
 * Страница документации компонента: порядок блоков autodocs Storybook и «Варианты» перед остальными
 * историями - как во фрейме компонента в Figma: описание, матрица набора, ниже примеры.
 */

import { Controls, Description, Primary, Stories, Subtitle, Title } from '@storybook/addon-docs/blocks'
import type { IStoryframeConfig } from '../config.d.mts'
import { Variants } from './variants'

/**
 * Страница документации для `parameters.docs.page` с блоком «Варианты» по конфигурации проекта.
 * @param config конфигурация storyframe проекта (`storyframe.config.ts`)
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
