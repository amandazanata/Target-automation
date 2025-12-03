const express = require('express');
const path = require('path');
const environment = require('./config/environment');
const targetRouter = require('./routes/target');

const app = express();

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/target', targetRouter);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // eslint-disable-next-line no-console
  console.error('Unhandled error', err);
  res.status(500).json({ message: 'Internal server error' });
});

if (require.main === module) {
  app.listen(environment.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${environment.port}`);
  });
}

module.exports = app;

// teste teste
