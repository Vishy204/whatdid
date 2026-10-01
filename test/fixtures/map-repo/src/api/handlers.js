const { formatDate } = require('../core/util');
function handle(req, res) { return formatDate(new Date()); }
module.exports = handle;
