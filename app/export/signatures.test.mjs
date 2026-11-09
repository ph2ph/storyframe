import { describe, expect, it } from 'vitest'
import { buildSignatureIndex, matchSignature, replaceInstances } from './signatures.mjs'

function frame(classes, children = [], path = '', box = { x: 0, y: 0, w: 10, h: 10 }) {
  return {
    type: 'frame',
    path,
    name: 'div',
    box,
    layout: { mode: 'none' },
    fills: [],
    radius: { values: [0, 0, 0, 0] },
    effects: [],
    clip: false,
    children,
    classes,
  }
}
const text = (value, path, h = 1) => ({
  type: 'text',
  path,
  name: 'Label',
  box: { x: 0, y: 0, w: 1, h },
  text: value,
  style: {},
  color: {},
  autoResize: 'both',
})

const BUTTON = (variant, state, extra = []) => ({
  variant: { Variant: variant, State: state },
  signature: ['MuiButton-root', 'MuiButtonBase-root', `MuiButton-${variant}`, 'MuiButton-sizeMedium', ...extra].sort(),
  tree: frame([], [text('Кнопка', '/0')]),
})

const COMPONENTS = [
  {
    id: 'Button',
    textProps: [{ name: 'Label', path: '/0' }],
    variants: [
      BUTTON('contained', 'default'),
      BUTTON('contained', 'hover'),
      BUTTON('contained', 'disabled', ['Mui-disabled']),
      BUTTON('text', 'default'),
    ],
  },
  {
    id: 'Chip',
    textProps: [],
    variants: [{ variant: { Variant: 'tone' }, signature: ['MuiChip-root', 'MuiChip-tone'], tree: frame([]) }],
  },
]

describe('сигнатуры классов', () => {
  it('самая длинная сигнатура побеждает, при равных - вариант без состояния', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const classes = [
      'MuiButtonBase-root',
      'MuiButton-root',
      'MuiButton-contained',
      'MuiButton-sizeMedium',
      'MuiButton-colorPrimary',
      'css-x',
    ]
    expect(matchSignature(index, classes).entry.variant).toEqual({ Variant: 'contained', State: 'default' })
    expect(matchSignature(index, [...classes, 'Mui-disabled']).entry.variant.State).toBe('disabled')
    expect(matchSignature(index, ['MuiButton-root', 'MuiButton-outlined']).entry).toBeNull()
    expect(matchSignature(index, ['MuiButton-root', 'MuiButton-outlined']).component).toBe('Button')
    expect(matchSignature(index, ['MuiBox-root']).component).toBeNull()
    expect(matchSignature(index, classes, 'Button').entry).toBeNull()
  })

  it('узлы паттерна становятся экземплярами с подписью, комбинации вне матрицы - в отчёт', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const tree = frame(
      ['MuiCard-root'],
      [
        frame(
          ['MuiButtonBase-root', 'MuiButton-root', 'MuiButton-contained', 'MuiButton-sizeMedium'],
          [text('Запустить', '/0/0')],
          '/0',
        ),
        frame(['MuiButton-root', 'MuiButton-outlined'], [text('Ещё', '/1/0')], '/1'),
      ],
    )
    const { tree: result, dependsOn, outOfMatrix } = replaceInstances(tree, index, { where: 'Карточка' })
    expect(result.children[0]).toMatchObject({
      type: 'instance',
      component: 'Button',
      variant: { Variant: 'contained', State: 'default' },
      overrides: { text: { Label: 'Запустить' } },
    })
    expect(result.children[1].type).toBe('frame')
    expect(result.children[1].classes).toBeUndefined()
    expect(dependsOn).toEqual(['Button'])
    expect(outOfMatrix).toEqual(['Карточка /1: Button (MuiButton-root MuiButton-outlined)'])
  })

  it('узел, отличающийся от варианта не подписью, остаётся слоями с причиной', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const button = ['MuiButtonBase-root', 'MuiButton-root', 'MuiButton-contained', 'MuiButton-sizeMedium']
    const tree = frame(
      ['MuiCard-root'],
      [
        frame(button, [text('Сохранить', '/0/0')], '/0', { x: 0, y: 0, w: 40, h: 10 }),
        frame(button, [text('Две строки', '/1/0', 3)], '/1'),
        frame(button, [text('Отмена', '/2/0')], '/2'),
      ],
    )
    const { tree: result, kept } = replaceInstances(tree, index, { where: 'Форма' })
    expect(result.children.map((child) => child.type)).toEqual(['frame', 'frame', 'instance'])
    expect(kept).toEqual([
      'Форма /0: Button - /: ширина 40×10 ≠ 10×10',
      'Форма /1: Button - /0: высота текста 1×3 ≠ 1×1',
    ])
  })

  it('склеенный двойник варианта находится по своей сигнатуре и даёт экземпляр оставшегося варианта', () => {
    const merged = {
      id: 'Bar',
      textProps: [],
      variants: [
        {
          variant: { Color: 'primary' },
          signature: ['MuiAppBar-root', 'MuiAppBar-positionFixed'],
          tree: frame([]),
          aliases: [{ signature: ['MuiAppBar-root', 'MuiAppBar-positionStatic'], tree: frame([]) }],
        },
      ],
    }
    const index = buildSignatureIndex([merged])
    const { entry } = matchSignature(index, ['MuiAppBar-root', 'MuiAppBar-positionStatic'])
    expect(entry?.component).toBe('Bar')
    expect(entry?.variant).toEqual({ Color: 'primary' })
  })
})
