# kea-disposables

Never forget to clean up resources again. Works with kea `3.0.0` and up.

## The Problem

In typical React/Kea development, you often need to clean up resources when components unmount:

```js
// ❌ Easy to forget cleanup - leads to memory leaks
const logic = kea([
  listeners(({ cache }) => ({
    startPolling: () => {
      cache.timeout = setTimeout(pollData, 1000)
      // Oops! Forgot to clear timeout on unmount
    },
    subscribeToEvents: () => {
      document.addEventListener('click', cache.handler)
      // Oops! Forgot to remove listener on unmount  
    }
  }))
])
```

## The Solution

The disposables plugin makes resource cleanup impossible to forget:

```js
// ✅ Automatic cleanup - no memory leaks
import { disposablesPlugin } from 'kea-disposables'

resetContext({ plugins: [disposablesPlugin] })

const logic = kea([
  listeners(({ cache }) => ({
    startPolling: () => {
      // Setup runs immediately, returns cleanup function
      cache.disposables.add(() => {
        const timeout = setTimeout(pollData, 1000)
        return () => clearTimeout(timeout) // Cleanup runs on unmount
      })
    },
    subscribeToEvents: () => {
      cache.disposables.add(() => {
        const handler = (e) => console.log('clicked', e.target)
        document.addEventListener('click', handler)
        return () => document.removeEventListener('click', handler)
      })
    }
  }))
])
```

## Complete Example

Here's a real-world polling logic that demonstrates all the features:

```js
import { kea, actions, reducers, listeners } from 'kea'
import { disposablesPlugin } from 'kea-disposables'

resetContext({ plugins: [disposablesPlugin] })

const pollingLogic = kea([
  actions({
    startPolling: true,
    stopPolling: true,
    updateData: (data) => ({ data }),
    setInterval: (ms) => ({ ms })
  }),

  reducers({
    isPolling: [false, {
      startPolling: () => true,
      stopPolling: () => false
    }],
    interval: [5000, {
      setInterval: (_, { ms }) => ms
    }],
    data: [null, {
      updateData: (_, { data }) => data
    }]
  }),

  listeners(({ actions, values, cache }) => ({
    startPolling: () => {
      // This is the magic - setup runs immediately, returns cleanup
      // Using a key makes this idempotent - calling startPolling multiple times
      // won't create multiple intervals
      cache.disposables.add(() => {
        // pollData function omitted for brevity
        const pollData = () => { /* fetch data and call actions.updateData() */ }

        // Setup runs immediately - start polling right away
        pollData()
        const intervalId = setInterval(pollData, values.interval)

        // Return cleanup function
        return () => {
          clearInterval(intervalId)
          console.log('Polling stopped - interval cleared')
        }
      }, 'polling-interval')
    },

    setInterval: () => {
      // When interval changes, restart polling with new interval
      if (values.isPolling) {
        actions.stopPolling()
        actions.startPolling()
      }
    },

    stopPolling: () => {
      // Manually dispose the polling interval
      cache.disposables.dispose('polling-interval')
      console.log('Polling stopped manually')
    }
  }))
])

// Usage
pollingLogic.mount()
pollingLogic.actions.startPolling()

// When component unmounts or logic is destroyed:
pollingLogic.unmount() 
// → Automatically calls clearInterval(intervalId)
// → No memory leaks, no forgotten cleanup
```

## API

### `cache.disposables.add(setupFunction, key?)`

Like React's `useEffect`, you pass a setup function that runs immediately and returns a cleanup function.

- **`setupFunction`**: Function that runs immediately and returns a cleanup function
- **`key`** (optional): String key for idempotent registration

```js
// Auto-generated key - allows multiple disposables
cache.disposables.add(() => {
  const timeout = setTimeout(doSomething, 1000)
  return () => clearTimeout(timeout)
})

// Named key - replaces previous disposable with same key
cache.disposables.add(() => {
  const interval = setInterval(poll, 1000)
  return () => clearInterval(interval)
}, 'my-polling')

cache.disposables.add(() => {
  const newInterval = setInterval(poll, 500) // Faster polling
  return () => clearInterval(newInterval)
}, 'my-polling') // Replaces previous - old interval is cleared immediately
```

### `cache.disposables.dispose(key)`

Manually cleanup a specific disposable by its key.

- **`key`**: String key of the disposable to cleanup
- **Returns**: `boolean` - `true` if disposable was found and cleaned up, `false` otherwise

```js
// Add a keyed disposable
cache.disposables.add(() => {
  const interval = setInterval(poll, 1000)
  return () => clearInterval(interval)
}, 'polling')

// Later, manually stop it
const wasDisposed = cache.disposables.dispose('polling') // true
// The cleanup function runs immediately, interval is cleared

// Trying to dispose non-existent key returns false
cache.disposables.dispose('non-existent') // false
```

## Error Handling

The plugin handles disposal errors gracefully:

- **Failed disposables don't break others**: If one cleanup function throws an error, other disposables still run
- **Logs all errors**: All cleanup errors are logged with context

```js
cache.disposables.add(() => {
  return () => {
    throw new Error('cleanup failed')
  }
}, 'problematic')

cache.disposables.add(() => {
  console.log('This cleanup will still run')
  return () => console.log('Cleaned up successfully')
}, 'good')

// On unmount:
// → Console: "[KEA] Disposable cleanup failed in logic kea.logic.1: Error: cleanup failed"
// → Console: "Cleaned up successfully"
// → All disposables attempted, errors don't stop others
```

## Multi-Mount Logic Support

For keyed logics that can be mounted multiple times, disposables only run on the **final unmount**:

```js
const keyedLogic = kea([
  key((props) => props.id),
  listeners(({ cache }) => ({
    // ... setup disposables with cache.disposables.add()
  }))
])

keyedLogic({ id: 'user-123' }).mount() // Mount count: 1
keyedLogic({ id: 'user-123' }).mount() // Mount count: 2

keyedLogic({ id: 'user-123' }).unmount() // Mount count: 1 - disposables NOT called
keyedLogic({ id: 'user-123' }).unmount() // Mount count: 0 - disposables called now
```

## Why Use This Plugin?

1. **Prevents memory leaks**: Impossible to forget cleanup
2. **Cleaner code**: Cleanup logic lives next to setup code  
3. **Idempotent**: Named keys prevent duplicate registrations
4. **Manual control**: Dispose resources by key when needed
5. **Multi-mount safe**: Respects kea's mount counting
6. **Error resilient**: Failed disposables don't break others
7. **Zero dependencies**: Tiny addition to your bundle

Install with `pnpm install kea-disposables` and never leak resources again!