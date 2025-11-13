const express = require('express');
const environment = require('./config/environment');
const activitiesRouter = require('./routes/activities');

const app = express();

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.use('/activities', activitiesRouter);

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
