import { assertEquals } from '@std/assert'
import { connect } from './mod.ts'

interface User {
    id: string;
    name: string;
}

Deno.test(async function testKv() {
    const kv = connect({
        endpoint: 'http://localhost:8000/api',
        bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
        accessToken: '694a907a-6eb8-4389-9a4c-f4b665e142eb',
    })

    const key = ['users', 'ghostzero']
    const res = await kv.atomic()
        .check({key, version: null}) // `null` version mean 'no value'
        .set(key, {name: 'GhostZero'})
        .commit()

    assertEquals(true, res.ok)

    const entry1 = await kv.set<User>(key, {id: 'ghostzero', name: 'GhostZero2'})
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
