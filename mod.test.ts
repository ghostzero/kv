import { assertEquals } from '@std/assert'
import { connect } from './mod.ts'

interface User {
    name: string;
}

Deno.test(async function testKv() {
    const kv = connect({
        endpoint: 'http://localhost:8000/api',
        accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
    })

    const key = ['users', 'ghostzero']
    const res = await kv.atomic()
        .check({key, version: null}) // `null` version mean 'no value'
        .set(key, {name: 'GhostZero'})
        .commit()

    assertEquals(true, res.ok)

    const entry1 = await kv.set(key, {name: 'GhostZero2'})
    assertEquals('GhostZero2', entry1.value.name)

    const entry2 = await kv.get<User>(key)
    assertEquals('GhostZero2', entry2.value.name)


    const result = await kv.getMany<User>([
        key,
        ['users', 'gz_qa'],
    ])

    assertEquals(result.length, 2)
    assertEquals(result[1].value, null)
    assertEquals(result[1].version, null)

    const entries = await kv.list<User>({prefix: ['users']})
    for await (const entry of entries) {
        assertEquals('users', entry.key[0])
    }

    const deleted = await kv.delete(['users', 'ghostzero'])
    assertEquals(true, deleted)
})
