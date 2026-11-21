import {seed} from '../src/catalog'
if (!process.env.TABLE_NAME) throw Error('Set TABLE_NAME from the stack output.')
await seed()
console.log('Festival catalog and inventory seeded without overwriting existing rows.')
