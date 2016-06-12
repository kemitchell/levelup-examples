var table = require('markdown-table')

module.exports = function printTable (level, heading, callback) {
  var data = [ [ 'Key', 'Value' ] ]
  level.createReadStream()
    .on('data', function (record) {
      data.push([ record.key, JSON.stringify(record.value) ])
    })
    .on('end', function () {
      process.stdout.write(heading + ':\n\n' + table(data) + '\n\n')
      callback()
    })
}
