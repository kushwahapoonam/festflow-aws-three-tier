function handler(event) {
  var request = event.request;
  if (request.uri !== '/api' && request.uri.indexOf('/api/') !== 0 &&
      !request.uri.substring(request.uri.lastIndexOf('/') + 1).includes('.')) {
    request.uri = '/index.html';
  }
  return request;
}
