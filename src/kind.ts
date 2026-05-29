const Kinds = [ 'group', 'breakout', 'cancelled' ] as const
export type Kind = typeof Kinds[number]
