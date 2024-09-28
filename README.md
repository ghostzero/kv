# Key-Value Client

## Installation

To install the key-value store client, run the following command:

```bash
# deno
deno add jsr:@gz/kv

# npm (use any of npx, yarn dlx, pnpm dlx, or bunx)
npx jsr add @gz/kv
```

## Opening the Key-Value Store

To open the key-value store, run the following command:

```ts
import { connect } from "@gz/kv";

const kv = connect({
    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
    accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
    region: 'eu-central-1'
});
```

## Creating a User interface

Since we're going to use TypeScript, we can create an interface for our User object. So it's easier to work with.
Here we define a User interface with a name and an email for example.

```typescript
interface User {
    id: string;
    name: string;
    email: string;
}
```

## Creating, updating, and reading a key-value pair

Now, we can create our first key-value pair. We use the `set()` method to create a new key-value pair. The key is an
array of strings and the value is the value you want to store. Internally, the key-array is joined with a separator to
create a unique key.

```typescript
const key = ['users', '1'];
const value: User = {id: '1', name: 'GhostZero', email: 'example@example.com'};
await kv.set(key, value);
```

Once the key-value pair is created, you can read it back using the `get()` method. The `get()` method returns an object
with the `key`, `value`, and `version`.

```typescript
const key = ['users', '1'];
const entry = await kv.get<User>(key);

console.log(entry.key);
console.log(entry.value);
console.log(entry.version);
```

## Deleting a key-value pair

You can delete a key-value pair using the `delete()` method. The `delete()` method returns a boolean indicating if the
key-value pair was deleted.

```typescript
const key = ['users', '1'];
await kv.delete(key);
```

## Atomic transactions

The Key-Value Store supports atomic transactions. This means that you can perform multiple operations in a single
transaction. If any of the operations fail, the entire transaction is rolled back.

```typescript
const key = ['users', '1'];
const value: User = {id: '1', name: 'GhostZero', email: 'example@example.com'};

const res = kv.atomic()
    .check({key, version: null /* or a version */})
    .set(key, value)
    .commit();

if (res.ok) {
    console.log('Entry did not exist and was created');
} else {
    console.log('Entry already exist. No changes were made');
}
```

## Improve querying with secondary indexes

With the Key-Value Store, you can only query by the key. If you want to query by a different field, you can create a
secondary index. A secondary index is a key-value pair where the key is the field you want to query by and the value is
the primary key.

```typescript
async function saveUser(user: User) {
    const key = ['users', user.id]

    // set the primary key
    const r = await kv.set(key, user)

    // set the secondary key's value to be the primary key
    await kv.set(['users_by_email', user.email], key)

    return r
}

async function getById(id) {
    // use as usual
    return await kv.get<User>(['users', id])
}

async function getByEmail(email) {
    // lookup the primary key by the secondary key
    const r1 = await kv.get<array[]>(['users_by_email', email])
    const r2 = await kv.get<User>(r1.value)
    return r2
}
```

## Client-side Encryption

The Key-Value Store supports client-side encryption. This means that the data is encrypted before it is sent to the
server. The server only sees the encrypted data and cannot decrypt it. The encryption key is stored on the client-side
and is never sent to the server.

### Generating a key

To generate a new encryption key, you can use the `generateCryptoKey()` function. The `generateCryptoKey()` function
returns a new encryption key. You can then export the key using the `exportCryptoKey()` function.

The exported key is a Base64-encoded string that you can store in a secure location and import later.

> [!CAUTION]
> Make sure to store the encryption key in a secure location. If you lose the encryption key, you will not be able to
> decrypt the encrypted data. The Key-Value Store does not store the encryption key!

```typescript
import { generateCryptoKey, exportCryptoKey } from "@gz/kv";

// generate a new encryption key
const cryptoKey = await generateCryptoKey();
const exportedKey = await exportCryptoKey(cryptoKey);

// you can store the exported key in a secure location
console.log(exportedKey);
```

### Using the key

To use the encryption key, you can import the key using the `importCryptoKey()` function. The `importCryptoKey()`
function takes the exported key as an argument and returns the encryption key which you can use to connect to the
key-value store.

> [!IMPORTANT]
> Client-side encryption can be enabled anytime by passing the encryption key to the `connect()` function. Once enabled,
> it cannot be disabled. If you lose the encryption key, you will not be able to decrypt the encrypted data.

```typescript
import { connect, importCryptoKey } from "@gz/kv";

// import the key
const encryptionKey = await importCryptoKey(exportedKey);

// connect to the key-value store with the encryption key
const kv = connect({
    bucket: '9d1cb4c7-c683-4fa9-bc5f-13f5ad1ba745',
    accessToken: '9b9634a1-1655-4baf-bdf5-c04feffc68bd',
    region: 'eu-central-1',
    encryptionKey
});
```
