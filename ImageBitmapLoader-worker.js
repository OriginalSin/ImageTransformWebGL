'use strict';

// var log = self.console.log.bind(self.console);

function ImageHandler(workerContext) {
    this.maxCount = 16;
    this.loading = 0;
    this.queue = [];
    this.workerContext = workerContext;
}
ImageHandler.prototype = {

	enqueue: function(evt) {
		var toEnqueue = evt.data;
		if (this.queue.indexOf(toEnqueue) < 0) {
			this.queue.push(toEnqueue);
			this.processQueue();
		}
	},

	processQueue: function() {
		if (this.queue.length > 0 && this.loading < this.maxCount) {
			var queue = this.queue.shift(),
				url = queue.src,
				options = queue.options || {},
				out = {url: url, load: true};
			this.loading++;
			return fetch(url, options)					// Fetch the image.
				.then(function(response) {
					out.load = true;
					this.loading--;
					// this.workerContext.postMessage(out);
					if (response.status !== 200) {
						out.error = 'Unable to load resource with url ' + url;
						//log('status !== 200', out);
						return this.workerContext.postMessage(out);
					}
					return response.blob();
				}.bind(this))
				.then(createImageBitmap)				// Turn it into an ImageBitmap.
				.then(function(imageBitmap) {			// Post it back to main thread.
					out.imageBitmap = imageBitmap;
					this.workerContext.postMessage(out, [imageBitmap]);
				}.bind(this), function(err) {
					out.error = err.toString();
					this.workerContext.postMessage(out);
				}.bind(this))
				.then(this.processQueue.bind(this))				// Check the queue.
				.catch(this.processQueue.bind(this))
		}
	}
};
var handler = new ImageHandler(self);
self.onmessage = handler.enqueue.bind(handler);
