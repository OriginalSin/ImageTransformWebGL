var ext = L.extend({
	options: {
    },
	initialize: function (url, anchors, options) { // (String, LatLngs, Object)
		this._url = url;
		L.Util.setOptions(this, L.extend(this.options, options));
		this._topLeft = L.point(0, 0);
		this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-transform');
		this._gl = this.createGL(this._canvas);
		this._trianglesIndex = [];
        this.setAnchors(anchors);
	},

	onAdd: function (map) {
		this._initImage();
		var pane = this.getPane();
		pane.insertBefore(this._image, pane.firstChild);
		// map.on('moveend resize', this._reset, this);
		map
			.on('resize', this._onresize, this)
			.on('moveend', this._onmoveend, this);
		if (this.options.interactive) {
			L.DomUtil.addClass(this._image, 'leaflet-interactive');
			this.addInteractiveTarget(this._image);
		}
		this._reset();
	},

	onRemove: function () {
		map
			.off('resize', this._onresize, this)
			.off('moveend', this._onmoveend, this);
		L.DomUtil.remove(this._image);
		if (this.options.interactive) { this.removeInteractiveTarget(this._image); }
	},

    _onmoveend: function () {
		this._topLeft = this._map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setTransform(this._image, this._topLeft, 1);
		this._reset();
	},
	_onresize: function () {
		var map = this._map,
			size = map.getSize();

		this._canvas.width = size.x; this._canvas.height = size.y;
		this._onmoveend();
	},

    _onImageError: function () {
        this.fire('error');
    },

    _onImageLoad: function () {
		this._imageReady();
		// if (this._imgNode.decode) {
			// this._imgNode.decode({notifyWhen: 'paintable'})		// {firstFrameOnly: true}
				// .then(L.bind(this._imageReady, this))
				// .catch(function (ev) {
					// throw new Error(ev);
				// });
		// }
    },

    _imageReady: function () {
		this._imageBitmap = this._createTexture(this._imgNode);
		this.setAnchors();
		if (this.options.clip) { this.setClip(this.options.clip) }
		this._redraw();
    },

    _initImage: function () {
		// L.gmx.workerPromise.then(function() {
			// if (L.gmx.getBitmap) {
				// L.gmx.getBitmap(this._url).then(function(ev) {
					// if (ev.imageBitmap) {
						// this._imgNode = ev.imageBitmap;
						// this._imageReady();
					// } else {
						// console.warn('bitmap not found: ', this._url);
					// }
				// }.bind(this));
			// } else {
				this._imgNode = L.DomUtil.create('img', 'gmxImageTransform');
				L.extend(this._imgNode, {
					galleryimg: 'no',
					onselectstart: L.Util.falseFn,
					onmousemove: L.Util.falseFn,
					onload: L.bind(this._onImageLoad, this),
					onerror: L.bind(this._onImageError, this),
					src: this._url
				});
			// }
		// }.bind(this));

        this._image = L.DomUtil.create('div', 'leaflet-image-layer');
		this._image.appendChild(this._canvas);
		var map = this._map,
			size = map.getSize();
		this._canvas.width = size.x; this._canvas.height = size.y;

		L.DomUtil.addClass(this._image, 'leaflet-zoom-' + (map.options.zoomAnimation && L.Browser.any3d ? 'animated' : 'hide'));
		if (this.options.className) { L.DomUtil.addClass(this._image, this.options.className); }
		if (this.options.zIndex) { this._updateZIndex(); }
    },

	_animateZoom: function (e) {
        var map = this._map;
		L.DomUtil.setTransform(this._image,
		    map._latLngBoundsToNewLayerBounds(map.getBounds(), e.zoom, e.center).min,
			map.getZoomScale(e.zoom)
		);
    },

	_reset: function () {
		if(this._imageBitmap) {
			this.setAnchors();
			this._redraw();
		}
	},

    _getMatrix4fv: function () {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height,
			px = this._anchors.map(function(it) {
				var p = map.layerPointToContainerPoint(map.latLngToLayerPoint(it));
				return [w * p.x - 1, 1 - h * p.y];
			}.bind(this));

        var m = L.gmx.WebGL.getMatrix4fv(this._srcPoints, [
			px[0][0], px[0][1],		// tl
			px[1][0], px[1][1],		// tr
			px[3][0], px[3][1],		// bl
			px[2][0], px[2][1]		// br
		]);
        this._matrix4fv = m.matrix4fv;
        this._matrix3d = m.matrix3d;
        this._matrix3dInverse = m.invMatrix;
		return this.matrix4fv;
	},

    setAnchors: function (anchors) {
		if (anchors) {
			this._anchors = anchors;
		}

        if (this._map) {
			this._getMatrix4fv();
			if (!this.options.clip) {
				this._clipFlatten = this._getFlatten([[
					this._anchors.map(function (it) {
						return it instanceof L.LatLng ? [it.lng, it.lat] : [it[1], it[0]];
					})
				]]);
				this._getClipTriangles();
			}
            this._redraw();
        }
    },

    setClip: function (clip) {
		clip = clip || this.options.clip;
		this.options.clip = clip;
		var type = clip.type.toLowerCase(),
			coords = type.toLowerCase() === 'polygon' ? [clip.coordinates] : clip.coordinates;

		this._clipFlatten = this._getFlatten(coords);

        if (this._map) {
			if (!this._matrix4fv) { this._getMatrix4fv(); }
			this._getClipTriangles();
			this._redraw();
		}
	},

    getClip: function () {
		if (this.options.clip && this._clipFlatten) {
			var coords = this._flattenToCoords(this._clipFlatten)
			if (this.options.clip.type.toLowerCase() === 'polygon') {
				coords = coords[0];
			}
			this.options.clip.coordinates = coords;
		}
        return this.options.clip;
	},

    // _vertices: new Float32Array(0),
    _getClipTriangles: function () {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height;
		var vertices = [];

        for (var i = 0, len = this._clipFlatten.length; i < len; i++) {
            var data = this._clipFlatten[i],
				size = data.dimensions;

			data._pixelClipPoints = new Array(data.vertices.length);
			for (var j = 0, len1 = data.vertices.length; j < len1; j += size) {
				var lp = map.latLngToLayerPoint([data.vertices[j + 1], data.vertices[j]]),
					p = map.layerPointToContainerPoint(lp),
					px = L.ImageTransform.Utils.project(this._matrix3dInverse, w * p.x - 1, 1 - h * p.y);
				data._pixelClipPoints[j] = px[0];
				data._pixelClipPoints[j + 1] = px[1];
			}
        }
        for (var i = 0, len = this._clipFlatten.length; i < len; i++) {
            var data = this._clipFlatten[i],
				index = L.gmx.WebGL.earcut(data.vertices, data.holes, data.dimensions);

			for (var j = 0, len1 = index.length; j < len1; j++) {
				var ind = 2 * index[j];
				vertices.push(data._pixelClipPoints[ind], data._pixelClipPoints[ind + 1]);
			}
        }
		this._vertices = new Float32Array(vertices);
		return this._vertices;
	},

    _flattenToCoords: function (arr) {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height,
				out = [],
			coords = [];

        for (var i = 0, len = arr.length; i < len; i++) {
			var flatten = arr[i],
				size = flatten.dimensions || 2,
				holeIndex = 0,
				nextHole = flatten.holes[holeIndex++],
				ring = [],
				latlngs = [];

			for (var j = 0, len1 = flatten._pixelClipPoints.length; j < len1; j += size) {
				if (nextHole === j / size) {
					ring.push(latlngs);
					nextHole = flatten.holes[holeIndex++];
					latlngs = [];
				}				
				for (var p = 0, vec = []; p < size; p++) {vec.push(flatten._pixelClipPoints[j + p]);}
				var p1 = L.ImageTransform.Utils.project(this._matrix3d, vec[0], vec[1]),
					latlng = map.layerPointToLatLng(L.point((p1[0] + 1)/w, (1 - p1[1])/h)._add(this._topLeft));

				latlngs.push([latlng.lng, latlng.lat]);
			}
			ring.push(latlngs);
			coords.push(ring);
		}
		return coords;
	},

    _getFlatten: function (coordinates) {
		return coordinates.map(function(ring) {
			return L.gmx.WebGL.earcut.flatten(ring);
		});
	}
}, {
	_glOpts: { antialias: true, depth: false, preserveDrawingBuffer: true },
	_qualityOptions: { anisotropicFiltering: true, mipMapping: true, linearFiltering: true },
	_anisoExt: null,
	_glResources: null,
	_gl: null,
    _shaderVS: '\
		attribute vec2 aVertCoord;\
		uniform mat4 uTransformMatrix;\
		varying vec2 vTextureCoord;\
		void main(void) {\
			vTextureCoord = aVertCoord;\
			gl_Position = uTransformMatrix * vec4(aVertCoord, 0.0, 1.0);\
		}\
	',
	_shaderFS: '\
		precision mediump float;\
		varying vec2 vTextureCoord;\
		uniform sampler2D uSampler;\
		void main(void) {\
			if (vTextureCoord.x < 0.0 || vTextureCoord.x > 1.0 || vTextureCoord.y < 0.0 || vTextureCoord.y > 1.0)\
				discard;\
			gl_FragColor = texture2D(uSampler, vTextureCoord);\
		}\
	',
	createGL: function (canvas) {
		var gl =
			canvas.getContext('webgl', this._glOpts) ||
			canvas.getContext('experimental-webgl', this._glOpts);
		if(gl) {
			this._anisoExt =
				gl.getExtension('EXT_texture_filter_anisotropic') ||
				gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
				gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

			if(!this._anisoExt) {
				console.warn('Your browser doesn`t support anisotropic filtering.  Ordinary MIP mapping will be used.');
			}

			this._glResources = this._setupGlContext(gl);
		} else {
			console.warn('Your browser doesn`t seem to support WebGL.');
		}
		return gl;
	},

    _setupGlContext: function (gl) {
        var vertexShader = this._getShader(gl.VERTEX_SHADER, this._shaderVS, gl),
			fragmentShader = this._getShader(gl.FRAGMENT_SHADER, this._shaderFS, gl);

        if (vertexShader && fragmentShader) {
            var shaderProgram = gl.createProgram();				// Compile the program
            gl.attachShader(shaderProgram, vertexShader);
            gl.attachShader(shaderProgram, fragmentShader);
            gl.linkProgram(shaderProgram);

            if (gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
                gl.useProgram(shaderProgram);
                return {
					shaderProgram: shaderProgram,
					vertAttrib: gl.getAttribLocation(shaderProgram, 'aVertCoord'),	// Find and set up the uniforms and attributes
					transMatUniform: gl.getUniformLocation(shaderProgram, 'uTransformMatrix'),
					samplerUniform: gl.getUniformLocation(shaderProgram, 'uSampler'),
					vertexBuffer: gl.createBuffer(),		// Create a buffer to hold the vertices
					screenTexture: gl.createTexture()		// Create a texture to use for the screen image
				};
            }
        }
        return null;
    },

    _getShader: function (type, source, gl) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);  
            return null;
        }
        return shader; 
    },

	_createTexture: function (imageBitmap) {
		if(!this._gl || !this._glResources) { return; }
		var canvas = imageBitmap,
			ww = imageBitmap.width, hh = imageBitmap.height;

		//if (ww % 2 || hh % 2) {
			// Scale up the texture to the next highest power of two dimensions.
			canvas = document.createElement('canvas'),
			canvas.width = this._nextHighestPowerOfTwo(ww);
			canvas.height = this._nextHighestPowerOfTwo(hh);
			canvas.getContext('2d').drawImage(imageBitmap, 0, 0, ww, hh);
		//}

		var gl = this._gl,
			mipMapping = this._qualityOptions.mipMapping;
		gl.bindTexture(gl.TEXTURE_2D, this._glResources.screenTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		if(this._qualityOptions.linearFiltering) {
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipMapping ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		} else {
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipMapping ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		}
		
		if(this._anisoExt) {
			// turn the anisotropy knob all the way to 11 (or down to 1 if it is
			// switched off).
			var maxAniso = this._qualityOptions.anisotropicFiltering ? gl.getParameter(this._anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
			gl.texParameterf(gl.TEXTURE_2D, this._anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
		}
		
		if(mipMapping) { gl.generateMipmap(gl.TEXTURE_2D); }
		
		gl.bindTexture(gl.TEXTURE_2D, null);

		var w = ww / canvas.width, h = hh / canvas.height;
		this._srcPoints = new Float32Array([
			0, 0,  w, 0,  0, h,  w, h	// tl tr bl br
		]);
		return imageBitmap;
    },

    _nextHighestPowerOfTwo: function (x) {
        --x;
        for (var i = 1; i < 32; i <<= 1) {
            x = x | x >> i;
        }
        return x + 1;
    },

    _setClip: function () {
		var gl = this._gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this._glResources.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this._vertices, gl.STATIC_DRAW);
    },

    _redraw: function () {
		if(!this._map || !this._gl || !this._glResources || !this._vertices || !this._imageBitmap) { return; }

		var gl = this._gl;

		gl.clearColor(0, 0, 0, 0);
		gl.viewport(0, 0, this._canvas.width, this._canvas.height);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		gl.useProgram(this._glResources.shaderProgram);

		gl.bindBuffer(gl.ARRAY_BUFFER, this._glResources.vertexBuffer);
		gl.enableVertexAttribArray(this._glResources.vertAttrib);
		gl.vertexAttribPointer(this._glResources.vertAttrib, 2, gl.FLOAT, false, 0, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this._glResources.screenTexture);
		gl.uniform1i(this._glResources.samplerUniform, 0);

		gl.uniformMatrix4fv(this._glResources.transMatUniform, false, this._matrix4fv);
		if (this._vertices.length) {
			this._setClip();
		}
		gl.drawArrays(gl.TRIANGLES, 0, this._vertices.length / 2);		// draw the triangles
    },
});
L.ImageTransformWebGL = L.ImageOverlay.extend(ext);

L.imageTransformWebGL = function (url, bounds, options) {
	return new L.ImageTransformWebGL(url, bounds, options);
};
//Based on http://math.stackexchange.com/questions/296794/finding-the-transform-matrix-from-4-projected-points-with-javascript
(function() {
    function adj(m) { // Compute the adjugate of m
        return [
            m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
            m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
            m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
        ];
    }

    function multmm(a, b) { // multiply two matrices
        var c = Array(9);
        for (var i = 0; i !== 3; ++i) {
            for (var j = 0; j !== 3; ++j) {
                var cij = 0;
                for (var k = 0; k !== 3; ++k) {
                    cij += a[3 * i + k] * b[3 * k + j];
                }
                c[3 * i + j] = cij;
            }
        }
        return c;
    }

    function multmv(m, v) { // multiply matrix and vector
        return [
            m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
            m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
            m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
        ];
    }

    function basisToPoints(x1, y1, x2, y2, x3, y3, x4, y4) {
        var m = [
            x1, x2, x3,
            y1, y2, y3,
            1,  1,  1
        ];
        var v = multmv(adj(m), [x4, y4, 1]);
        return multmm(m, [
            v[0], 0, 0,
            0, v[1], 0,
            0, 0, v[2]
        ]);
    }
L.ImageTransform = {};
    L.ImageTransform.Utils = {
        general2DProjection: function(
              x1s, y1s, x1d, y1d,
              x2s, y2s, x2d, y2d,
              x3s, y3s, x3d, y3d,
              x4s, y4s, x4d, y4d
        ) {
          var s = basisToPoints(x1s, y1s, x2s, y2s, x3s, y3s, x4s, y4s);
          var d = basisToPoints(x1d, y1d, x2d, y2d, x3d, y3d, x4d, y4d);
          return multmm(d, adj(s));
        },

        project: function(m, x, y) {
            var v = multmv(m, [x, y, 1]);
            return [v[0] / v[2], v[1] / v[2]];
        },
        adj: adj
    };
})();

if (L.ImageTransform.Utils) {
	L.gmx = L.gmx || {};
	L.gmx.WebGL = L.gmx.WebGL || {};
	L.gmx.WebGL.getMatrix4fv = function(s, d) {		// get transform matrix and it`s inv
console.log('Получение матрицы', s, d); 
console.log('Библиотека m4', m4); 
		var m = L.ImageTransform.Utils.general2DProjection(
			s[0], s[1], d[0], d[1],	// top-left
			s[2], s[3], d[2], d[3],	// top-right
			s[4], s[5], d[4], d[5],	// bottom-left
			s[6], s[7], d[6], d[7]	// bottom-right
		);
		var matrix3d = m.slice();
		for (var i = 0; i !== 9; ++i) { m[i] = m[i] / m[8]; }
		var matrix4fv = [
			m[0], m[3],    0, m[6],
			m[1], m[4],    0, m[7],
			   0,    0,    0,    0,
			m[2], m[5],    0,    1
		];
		return {
			// matrix4fv: [
				// m[0], m[1],    0, m[6],
				// m[3], m[4],    0, m[7],
				   // 0,    0,    0,    0,
				// m[2], m[5],    0,    1
			// ],
			// matrix3d: matrix3d,
			matrix3d: m,
			// matrix3d: matrix4fv,
			// invMatrix: L.ImageTransform.Utils.adj(matrix3d),
			invMatrix: L.ImageTransform.Utils.adj(m),
			matrix4fv: matrix4fv
		};
	};
}
