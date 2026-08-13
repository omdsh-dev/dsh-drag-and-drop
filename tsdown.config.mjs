const checkout = process.env.DSH_CHECKOUT
if (checkout === undefined) {
  throw new Error('DSH_CHECKOUT is required; run `pnpm run build`')
}

const { clientBundle } = await import(`${checkout}/packages/client/tsdown.client.ts`)

export default clientBundle('@bill9109/dsh-drag-and-drop', [
  'lib/types/index.js',
  'lib/types/invariant.js',
])
