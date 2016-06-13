# Simple Indexing in a LevelUP Store

## Introduction

In this example, we'll store some very simple blog-post data in a [LevelUP]
data store.

[LevelUP]: https://www.npmjs.com/package/levelup

Here's an example of the kind of data we'll store for each post:

```javascript
var firstByAna = {
  title: "Ana's First Post",
  date: '2016-01-01',
  author: 'ana',
  slug: 'ana-1',
  text: 'Posted!'
}
```

Each post will have a slug, or string used to create permanent links to
the post.  Every post slug will be unique.

Each post will also have an author and an ISO-8601 (YYYY-MM-DD) date.
We will want to be able to query our data store for:

1. The complete content of any post, to display post pages.

2. A list of posts by any author, with complete text, to list on author
   index pages.

3. An arbitrary number of posts in date order, oldest-first or newest-first,
   for an archive view.  Title, date, author, and a way to link to the full
   text suffice.

In relational-database terms, we want to index our posts by author and date.

A couple more examples:

```javascript
var secondByBob = {
  title: 'Bob, Too!',
  date: '2016-01-02',
  author: 'bob',
  slug: 'bob-1',
  text: 'Bob write!'
}

var thirdByAna = {
  title: "Ana's Second Post",
  date: '2016-01-03',
  author: 'ana',
  slug: 'ana-2',
  text: 'More Ana.'
}
```

## "This is a test..."

```javascript
var assert = require('assert')
var done = false
```

The code in this file's fenced code blocks example can be run like a test.
You can extract is automatically with `npm install --global defence-cli &&
defence Simple-Index.md` and run it for yourself with `defence file | node`.

The `done` flag is set only when the last of our asynchronous callbacks
finishes, so we can test that everything was invoked as expected.

## Packages

```javascript
var levelup = require('levelup')
var memdown = require('memdown')
```

LevelUP is the key package for LevelUP data stores.  It provides the abstract
(or "generic") interface to data stores that follow its rules.

One of those data stores in `memdown`, which stores all data in memory.
`memdown` is a great choice when all the data your program will handle can
fit in memory, and for testing.

```javascript
var exists = require('level-exists')
var lock = require('level-lock')
```

LevelUP intentionally provides a very sparse API.  These packages provide
some additional, convenient APIs on top of that API, explained later.

## Initializing a LevelUP Data Store

```javascript
var options = { }
```

The `levelup` package exports a function for creating LevelUP data store
instances.  It takes an `Object` argument of configuration options.

```javascript
options.db = memdown
```

Here we configure LevelUP to use the `memdown` package as the underlying
store, or "storage back-end", for our LevelUP instance.

```javascript
options.keyEncoding = {
  encode: function (argument) {
    return argument.map(encodeURIComponent).join('/')
  },
  decode: function (argument) {
    return argument.split('/').map(decodeURIComponent)
  },
  buffer: false
}
```

Here we configure how our LevelUP will encode the keys in its key-value store.
LevelUP keys can be nearly any kind of serializable data.

In this example, every key has a list-like form.  We escape and combine the
components of a key into a string much like a URI's path name or a file path.

```javascript
options.valueEncoding = 'json'
```

Here we configure how our LevelUP will encode values in its key-value store.
LevelUP has built-in support for automatically serializing and deserializing
values as JSON.

```javascript
levelup('ignored', options, function (error, level) {
  assert.ifError(error)
```

Initialize the LevelUP with our configuration options and provide a callback.
Calling the same initializer function without a callback returns an instance.

The first parameter to `levelup` is usually the path the underlying store
should use to write data to disk.  Since `memdown` stores data in memory,
the argument is ignored.

```javascript
  exists.install(level)
```

LevelUP's API provides `.get(key, callback)`, which will call back with an
error if the requested key does not exist.  If the error has a `.notFound`
property, the error was due to there being no record with the key in the store.

LevelUPs also provide a streaming query method, `.createReadStream`, that
can be used to stream keys, values, or both, throughout the store, at a key
or within a key range.

Using either of these methods just to check if the store has a value at a
certain key would involve a bit of boilerplate.  `level-exists` provides a
"plug-in" method for LevelUP stores, built on top of `.createReadStream`,
that is much more terse and intuitive.  Here, we install it onto our LevelUP
instance.

```javascript
  putAndQueryData(level)
})
```

We will store and query data in the LevelUP instance a bit later.  But for
now, we turn to some helper functions that show how keys are queries are
structured to meet our needs.

## Storing Posts

```javascript
function putPost (level, post, callback) {
  var postKey = [ 'posts', post.slug ]
```

Since post slugs must be unique, we need to check whether we already have
a key-value pair for a post with the same slug.  We can do so by reading
whether our LevelUP instance has a value for the post key, and only writing
new key-value pairs if that key does not yet exist.

However, there is an edge case where, in order:

1. A request starts to write Post A.

2. A request starts to write Post B, with the same slug as Post A.

3. The Post A request asynchronously reads the store to check for the
   key with slug.

4. The Post B request asynchronously reads the store to check for the same key.

5. The store responds to #3, confirming there is no such key.

6. The store responds to #4, confirming there is no such key.

7. Both requests, having confirmed the key does not exist, begin writing
   (and overwriting) each others' keys.

To avoid this, we can make a note, in memory, as soon as the first request
begins.  Each request can, in turn, check to see whether another request
is currently working on the same key.  `level-lock` helps with this process,
keeping track of advisory locks on a per-key basis and returning functions used
to unlock once the writing operations that follow the initial read complete.
Since our LevelUP can only be accessed by one process, and our JavaScript
will execute with just one line of execution, `level-lock` can store locks
in memory.

```javascript
  var unlock = lock(level, postKey, 'w')
  if (!unlock) callback(new Error('Conflict'))
  else {
    level.exists(postKey, function (error, exists) {
      if (error) callback(error)
      else {
        if (exists) callback(new Error('Slug already taken'))
        else {
```

At this point we know that there is no key for the slug and we have locked
the right to create it.

A naive way to find posts by a specific author, or to find the newest,
would be to stream every key-value pair storing a post and pick out those
meeting our criteria.  That's a perfectly fine approach when there won't
be many posts to store or requests to find them.  You may be surprised how
many real use cases can be plenty well served by that kind of approach,
especially when using high-performance storage back-ends.

However, when data is plentiful, the storage back-end sluggish, or performance
standards tight, avoid scanning everything in the LevelUP.  You can do this
by setting an additional key-value pair for each kind of query we'd like to
perform: posts-by-author and _n_-posts-in-date-order.

LevelUP instances store key-value pairs in sorted order, and we can query
LevelUP instances for keys, values, and key-value pairs within ranges of keys.
One way to do so is to prefix keys for different kinds of queries.

```javascript
          var batch = [
            {
              type: 'put',
              key: [ 'by', post.author, post.slug ],
              value: ''
            },
```

This put operation gives us records with keys like `by/$author/$slug`
and space saving placeholder values.  As we'll see later, we can use the
sort-order of characters in these keys to craft a range of keys that include
just those beginning with a prefix like `by/$author/`.

Empty placeholder values embody a trade-off.

For:

1. They save storage space.

2. Since we can fetch the full data for any post with its slug, the keys
   of these records give us all we need to make additional `.get` requests
   for the data we need.

3. If we expect to support post title and text editing, we need only change
   these values in the record holding post data.  We won't have to make
   identical changes to the index record value.

Against:

1. To get the data we need, we must now run multiple queries, in two stages.
   First we stream the keys that point to the posts we need.  This is more
   complex.

2. The more complex query will also be slower.  In particular, the second-stage
   `.get` calls don't play to LevelDB's strength in high-performance sequential
   reads, or reads that involve multiple keys in a row.

3. If we expect to support deleting posts entirely, we may encounter situations
   where a post is listed in the first stage of our query, but deleted by
   the time we make our `.get` for the post.

```javascript
            {
              type: 'put',
              key: [ 'date', post.date, post.slug ],
              value: {
                title: post.title,
                date: post.date,
                author: post.author,
                slug: post.slug
              }
            },
```

This index record enables searching by date.  Since LevelUP sorts key-value
pairs by key in lexicographic order, and ISO-8601 (YYYY-MM-DD) dates in
lexicographic order are also in date order, these keys will be stored
in date order.  We'll stream these keys to find the oldest posts in our
LevelUP instance.

Again, we face a trade-off in deciding what to store in the index record value.
We could again use placeholder values and a two-stage query.  In this case,
since the data we need to display for the query is quite limited and the main
space concern is probably post text, copying the needed properties works well.

```javascript
            { type: 'put', key: postKey, value: post }
          ]
```

This put operation stores the whole post object in a key based on the post's
unique slug.

```javascript
          level.batch(batch, function (error) {
```

To guarantee that our LevelUP instance won't end up with the key-value pair
for the post data itself, but not all the index records that go with it,
say due to a crash, we submit the `put` operations for the post data and
indices as a batch.  Either all the operations in this batch will succeed,
or all will fail.

Note that we can't do `.get` operations in a batch, nor can we tell LevelUP to
write key-value pairs only if the keys don't already exist.  This operation
is sometime called an "upsert".  Rather, we have guarantee that atomicity
ourselves, by locking before reading to check for the key and unlocking one
we've written.

```javascript
            unlock()
```

We're done reading and writing to the LevelUP instance, so it's now safe to
"unlock" the post key containing the unique post slug.

```javascript
            callback(error)
          })
        }
      }
    })
  }
}
```

## Finding Posts by Author

```javascript
function postsBy (level, name, callback) {
  var options = {
    gte: [ 'by', name, '' ],
    lte: [ 'by', name, '~' ],
    keys: true,
    values: false
  }
```

These query options define a range of keys that include all those with
the prefix `by/$author/`.  For an author called `dale`, this is the
range beginning with `by/dale/` and ending with `by/dale/~`.  Note that
`~` is the "highest" ASCII-encoded printable character (`176`/`126`/`7E`
octal/decimal/hex) and we have configured LevelUP to encode each part of
our keys with `encodeURIComponent`, with ASCII-only escape codes.

Since the values of these key-value pairs will be empty placeholders, we can
have LevelUP stream only keys.  Some storage back-ends, in particular the most
popular, LevelDB, can provide just keys more efficiently than keys with values.

```javascript
  var slugs = [ ]
  level.createReadStream(options)
    .on('data', function (key) {
      var slug = key[2]
      slugs.push(slug)
    })
```

We gather the third key component, the slug, from each matching index key.

```javascript
    .once('end', function () {
      map(slugs, getPost, callback)
      function getPost (slug, done) {
        var key = [ 'posts', slug ]
        level.get(key, done)
      }
    })
```

Once we have all the slugs, we do a `.get` for corresponding post data.

```javascript
    .once('error', callback)
}
```

Just in case.

## Finding Oldest Posts

```javascript
function oldestPosts (level, howMany, callback) {
  var options = {
    gte: [ 'date', '' ],
    lte: [ 'date', '~' ],
    keys: false,
    values: true,
    limit: howMany,
    reverse: true
  }
```

Our approach here is much the same as for posts by author, but make more use
of the fact that keys will stream in sorted order.  Since the ISO-8601 dates
in these key names put them in order, we use `reverse` to get the oldest,
rather than newest.  The `limit` option works much the same as SQL's `LIMIT`.

Note that since all the information we need is in record values, we need
not stream keys.

```javascript
  var values = [ ]
  level.createReadStream(options)
    .on('data', function (value) {
      values.push(value)
    })
    .once('end', function () {
      callback(null, values)
    })
    .once('error', callback)
}
```

Note that there is just one, streaming query.

## Step by Step

Here we put our functions to work:

```javascript
var map = require('async.map')
var series = require('async-series')

function putAndQueryData (level) {
  series(
    [
      putPost.bind(null, level, firstByAna),
      putPost.bind(null, level, secondByBob),
      putPost.bind(null, level, thirdByAna),
```

At this point, the key-value data in our LevelUP instance looks a bit like:

| Key                   | Value                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| by/ana/ana-1          | ""                                                                                                 |
| by/ana/ana-2          | ""                                                                                                 |
| by/bob/bob-1          | ""                                                                                                 |
| date/2016-01-01/ana-1 | {"title":"Ana's First Post","date":"2016-01-01","author":"ana","slug":"ana-1"}                     |
| date/2016-01-02/bob-1 | {"title":"Bob, Too!","date":"2016-01-02","author":"bob","slug":"bob-1"}                            |
| date/2016-01-03/ana-2 | {"title":"Ana's Second Post","date":"2016-01-03","author":"ana","slug":"ana-2"}                    |
| posts/ana-1           | {"title":"Ana's First Post","date":"2016-01-01","author":"ana","slug":"ana-1","text":"Posted!"}    |
| posts/ana-2           | {"title":"Ana's Second Post","date":"2016-01-03","author":"ana","slug":"ana-2","text":"More Ana."} |
| posts/bob-1           | {"title":"Bob, Too!","date":"2016-01-02","author":"bob","slug":"bob-1","text":"Bob write!"}        |

Note that we've "stored" three posts, but created nine key-value pairs,
or three pairs per post.  Of those:

1. One indexes the post by author.

2. One indexes the post by date.

3. One stores post data.

```javascript
      function (done) {
        postsBy(level, 'ana', function (error, posts) {
          assert.ifError(error)
          assert.deepEqual(posts, [ firstByAna, thirdByAna ])
          done()
        })
      },

      function (done) {
        oldestPosts(level, 2, function (error, posts) {
          assert.ifError(error)
          assert.deepEqual(
            posts,
            [
              withoutTitle(thirdByAna),
              withoutTitle(secondByBob)
            ]
          )
          done()
        })
        function withoutTitle (post) {
          var copy = Object.assign({ }, post)
          delete copy.text
          return copy
        }
      }
    ],
```

Here we see that we can use the extra key-value pairs put into the LevelUP
instance to provide the functionality akin to column indices and `ORDER BY`
in a traditional relational database.  These queries read from the LevelUP
instance multiple times, but do not iterate irrelevant key-value pairs.

```javascript
    function (error) {
      assert.ifError(error)
      done = true
    }
  )
}

process.on('exit', function () {
  assert(done)
  process.stdout.write('Tests passed.\n')
})
```

This code ensures that all our asynchronous callbacks were triggered as
expected, and therefore all our assertions were checked.
