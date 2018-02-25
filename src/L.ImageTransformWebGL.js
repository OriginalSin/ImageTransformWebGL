var ext = L.extend({
	options: {
    },
	initialize: function (url, anchors, options) { // (String, LatLngs, Object)
		this._url = url;
		L.Util.setOptions(this, L.extend(this.options, options));
		this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-transform');
		this._gl = this.createGL(this._canvas);
		this._trianglesIndex = [];
        this.setAnchors(anchors);
	},

	onAdd: function (map) {
		this._initImage();
		var pane = this.getPane();
		pane.insertBefore(this._image, pane.firstChild);
		map.on('moveend', this._reset, this);
		if (this.options.interactive) {
			L.DomUtil.addClass(this._image, 'leaflet-interactive');
			this.addInteractiveTarget(this._image);
		}
		this._reset();
	},

	onRemove: function () {
		map.off('moveend', this._reset, this);
		L.DomUtil.remove(this._image);
		if (this.options.interactive) { this.removeInteractiveTarget(this._image); }
	},

    _initImage: function () {
		L.gmx.getBitmap(this._url).then(function(ev) {
			if (ev.imageBitmap) {
				this._imageBitmap = this._createTexture(ev.imageBitmap);
				if (this.options.clip) { this.setClip(this.options.clip) }
				this._redraw();
			} else {
				console.warn('bitmap not found: ', this._url);
			}
		}.bind(this));
        this._image = L.DomUtil.create('div', 'leaflet-image-layer');
		this._image.appendChild(this._canvas);

		L.DomUtil.addClass(this._image, 'leaflet-zoom-' + (this._map.options.zoomAnimation && L.Browser.any3d ? 'animated' : 'hide'));
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
		var map = this._map,
			size = map.getSize();

		this._canvas.width = size.x; this._canvas.height = size.y;
		L.DomUtil.setTransform(this._image, map.containerPointToLayerPoint([0, 0]), 1);
		this._redraw();
	},

    setAnchors: function (anchors) {
        this._anchors = anchors;
        if (!this.options.clip) {
			this._setTrianglesIndex(this._anchors);
        }

        if (this._map) {
			this._getMatrix4fv();
            this._redraw();
        }
    },

    setClip: function (clip) {
		this.options.clip = clip;

        if (this._map) {
			if (!this._matrix4fv) { this._getMatrix4fv(); }
			this._setTrianglesIndex(this.options.clip);
			this._getClipTriangles();
			this._redraw();
		}
	},

    getClip: function () {
		if (this._pixelClipPoints) {
			this.options.clip = this._getLatLngsFromPixelPoints(this._pixelClipPoints);
		}
        return this.options.clip;
	},

    _getMatrix4fv: function () {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height,
			px = this._anchors.map(function(it) {
				var p = map.layerPointToContainerPoint(map.latLngToLayerPoint(it));
				return [w * p.x - 1, 1 - h * p.y];
			}.bind(this));

        var m = L.gmx.WebGL.getMatrix4fv(this._srcPoints, [
			px[3][0], px[3][1],		// bl
			px[2][0], px[2][1],		// br
			px[0][0], px[0][1],		// tl
			px[1][0], px[1][1]		// tr
		]);
        this._matrix4fv = m.matrix4fv;
        this._matrix3d = m.matrix3d;
        this._matrix3dInverse = m.invMatrix;
		return this.matrix4fv;
	},

    _getLatLngsFromPixelPoints: function (pixels) {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height;
		return pixels.map(function(it) {
			var p = L.ImageTransform.Utils.project(this._matrix3d, it[0], it[1]);
			return map.layerPointToLatLng(L.point((p[0] + 1)/w, (1 - p[1])/h));
		}.bind(this));
	},

    _getPixelPointsFromLatLngs: function (latlngs) {
		var map = this._map,
			w = 2 / this._canvas.width, h = 2 / this._canvas.height;
		return latlngs.map(function(it) {
			var p = map.layerPointToContainerPoint(map.latLngToLayerPoint(it)),
				px = L.ImageTransform.Utils.project(this._matrix3dInverse, w * p.x - 1, 1 - h * p.y);
			return [px[0], px[1]];
		}.bind(this));
	},

    _getClipTriangles: function () {
		var vertices = [],
			points = this._getPixelPointsFromLatLngs(this.options.clip || this._anchors);

		this._pixelClipPoints = points;
        for (var i = 0, len = this._trianglesIndex.length; i < len; i++) {
            var p = points[this._trianglesIndex[i]];
            vertices.push(p[0], p[1]);
        }
		this._vertices = new Float32Array(vertices);
		return this._vertices;
	},

    _setTrianglesIndex: function (coords) {
		if (coords) {
			if (coords[0] instanceof L.LatLng) {
				coords = coords.map(function(it) {return [it.lng, it.lat]; });
			}
			var data = L.gmx.WebGL.earcut.flatten([coords]);
			this._trianglesIndex = L.gmx.WebGL.earcut(data.vertices, data.holes, data.dimensions);
		}
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

		if (ww % 2 || hh % 2) {
			// Scale up the texture to the next highest power of two dimensions.
			canvas = document.createElement('canvas'),
			canvas.width = this._nextHighestPowerOfTwo(ww);
			canvas.height = this._nextHighestPowerOfTwo(hh);
			canvas.getContext('2d').drawImage(imageBitmap, 0, 0, ww, hh);
		}

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
		if(!this._map || !this._gl || !this._glResources || !this._imageBitmap) { return; }

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
		if (this._trianglesIndex.length) {
			this._setClip();
		}
		gl.drawArrays(gl.TRIANGLES, 0, this._trianglesIndex.length);		// draw the triangles
    },
});
L.ImageTransformWebGL = L.ImageOverlay.extend(ext);

L.imageTransformWebGL = function (url, bounds, options) {
	return new L.ImageTransformWebGL(url, bounds, options);
};

if (L.ImageTransform.Utils) {
	L.gmx = L.gmx || {};
	L.gmx.WebGL = L.gmx.WebGL || {};
	L.gmx.WebGL.getMatrix4fv = function(s, d) {		// get transform matrix and it`s inv
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
