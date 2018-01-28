<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">

    <script src="//www.kosmosnimki.ru/lib/geomixer_1.3/geomixer-src.js?key=E5FB6CCB5D23B5E119D2F1B26BCC57BD"></script>
    <link href="//www.kosmosnimki.ru/lib/geomixer_1.3/geomixer.css" rel="stylesheet" />

    <!--
    <script src="../src/L.ImageTransformWebGL.js"></script>
-->
    <script src="./examples/tools/numeric-1.2.6.js"></script>
    <script id="shader-fs" type="x-shader/x-fragment">
        precision mediump float;
        varying vec2 vTextureCoord;
        uniform sampler2D uSampler;
        void main(void)  {
            gl_FragColor = texture2D(uSampler, vTextureCoord);
        }
    </script>
     
    <script id="shader-vs" type="x-shader/x-vertex">
        attribute vec2 aVertCoord;
        uniform mat4 uTransformMatrix;
        varying vec2 vTextureCoord;
        void main(void) {
            vTextureCoord = aVertCoord;
            gl_Position = uTransformMatrix * vec4(aVertCoord, 0.0, 1.0);
        }
    </script>

    <style>
        html, body, #map, #screenCanvas {
            height: 100%;
            width: 100%;
            margin: 0px;
        }
    </style>
	<title>GeoMixer API - примеры подключения оперативных данных по пожарам</title>
</head>

<body>
	<div id="map"></div>

<script>
//L.Icon.Default.imagePath = '//www.kosmosnimki.ru/lib/geomixer_1.2/images/';
	var map = new L.Map('map', {
		center: new L.LatLng(56, 137.23),
		zoom: 9
	});

	var LayersControl = L.control.layers({
		Google: L.tileLayer('//mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'),
		Map: L.tileLayer.Mercator('//vec03.maps.yandex.net/tiles?l=map&v=17.09.21-1&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', {
			maxZoom: 21,
			maxNativeZoom: 17
		}).addTo(map)
	}).addTo(map);
	
var canvas = L.DomUtil.create('canvas', '');
var overlayPane = map.getPane('overlayPane');
overlayPane.insertBefore(canvas, overlayPane.firstChild);

// The normalised texture co-ordinates of the quad in the screen image.
var gl = null;

var gUtils = {
	_map: map,
	_img: null,
	_canvas: canvas,
	_imageAttr: null,
	_glOpts: { antialias: true, depth: false, preserveDrawingBuffer: true },
	_qualityOptions: {},
	_anisoExt: null,
	_glResources: null,
	srcPoints: null,
	controlPoints: null,
    _clipCoords: [
		[56.301281, 136.90579],
		[56.150009, 137.83902],
		[55.788635, 136.60979],
		[55.639533, 137.53169]
	],
	_anchors: [
		[56.344192, 136.59558],	// top-left
		[55.613245, 136.59558],	// top-right
		[55.613245, 137.8782],	// bottom-right
		[56.344192, 137.8782]	// bottom-left
	],
	createGL: function (canvas) {
		gUtils.syncQualityOptions();
		gl =
			canvas.getContext('webgl', gUtils._glOpts) ||
			canvas.getContext('experimental-webgl', gUtils._glOpts);
		if(!gl) {
			console.log("Your browser doesn't seem to support WebGL.");
		}

		gUtils._anisoExt =
			gl.getExtension('EXT_texture_filter_anisotropic') ||
			gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
			gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

		if(!gUtils._anisoExt) {
			console.log("Your browser doesn't support anisotropic filtering.  Ordinary MIP mapping will be used.");
		}

		gUtils._glResources = gUtils.setupGlContext();

		//initPoints();
		gUtils.setAnchors();
		gUtils._refresh();
	},

	syncQualityOptions: function () {
		gUtils._qualityOptions.anisotropicFiltering = 
		gUtils._qualityOptions.mipMapping = 
		gUtils._qualityOptions.linearFiltering = true;
		
		// re-load the texture if possible
		gUtils.loadScreenTexture();
	},
	setAnchors: function () {
		var w = gUtils._img.width,
			h = gUtils._img.height,
			pbbox = map.getPixelBounds(),
			pixelOrigin = map.getPixelOrigin(),
			center = pbbox.getBottomLeft();

		center.x += (pbbox.max.x - pbbox.min.x - w)/2;
		center.y -= (pbbox.max.y - pbbox.min.y + h)/2;
		
		if (gUtils._imageAttr) {
			gUtils._imageAttr.drawAnchors.remove();
		}

		gUtils._imageAttr = {
            screenBbox: pbbox
			,naturalWidth: gUtils._img.naturalWidth
			,naturalHeight: gUtils._img.naturalHeight
			,width: w
			,height: h
			,drawAnchors: map.gmxDrawing.add(L.polygon(gUtils._anchors))
		};
		gUtils._imageAttr.drawAnchors.on('edit', function(ev) {
			//console.log('kkk', ev);
			gUtils._refresh();
		});

	},
	getShader: function (type, id) {
		var source = document.getElementById(id).innerHTML;
		var shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			alert("Ошибка компиляции шейдера: " + gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);  
			return null;
		}
		return shader; 
	},
	setupGlContext: function () {
		// Store return values here
		var vertexShader = gUtils.getShader(gl.VERTEX_SHADER, 'shader-vs');
		var fragmentShader = gUtils.getShader(gl.FRAGMENT_SHADER, 'shader-fs');
		
		var rv = {};
		// Compile the program
		rv.shaderProgram = gl.createProgram();
		gl.attachShader(rv.shaderProgram, vertexShader);
		gl.attachShader(rv.shaderProgram, fragmentShader);
		gl.linkProgram(rv.shaderProgram);

		if (!gl.getProgramParameter(rv.shaderProgram, gl.LINK_STATUS)) {
			console.log('Shader linking failed.');
		}
			
		// Create a buffer to hold the vertices
		rv.vertexBuffer = gl.createBuffer();

		// Find and set up the uniforms and attributes        
		gl.useProgram(rv.shaderProgram);
		rv.vertAttrib = gl.getAttribLocation(rv.shaderProgram, 'aVertCoord');
			
		rv.transMatUniform = gl.getUniformLocation(rv.shaderProgram, 'uTransformMatrix');
		rv.samplerUniform = gl.getUniformLocation(rv.shaderProgram, 'uSampler');
			
		// Create a texture to use for the screen image
		rv.screenTexture = gl.createTexture();
		
		return rv;
	},

	loadScreenTexture: function () {
		if(!gl || !gUtils._glResources) { return; }
		
		var image = gUtils._img;
		var extent = { w: image.naturalWidth, h: image.naturalHeight };
		gl.bindTexture(gl.TEXTURE_2D, gUtils._glResources.screenTexture);
		
		// Scale up the texture to the next highest power of two dimensions.
		var canvas = document.createElement("canvas");
		canvas.width = gUtils.nextHighestPowerOfTwo(extent.w);
		canvas.height = gUtils.nextHighestPowerOfTwo(extent.h);
		
		var ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0, extent.w, extent.h);
		
		// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		
		if(gUtils._qualityOptions.linearFiltering) {
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
							 gUtils._qualityOptions.mipMapping
								 ? gl.LINEAR_MIPMAP_LINEAR
								 : gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		} else {
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, 
							 gUtils._qualityOptions.mipMapping
								 ? gl.NEAREST_MIPMAP_NEAREST
								 : gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		}
		
		if(gUtils._anisoExt) {
			// turn the anisotropy knob all the way to 11 (or down to 1 if it is
			// switched off).
			var maxAniso = gUtils._qualityOptions.anisotropicFiltering ?
				gl.getParameter(gUtils._anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
			gl.texParameterf(gl.TEXTURE_2D, gUtils._anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
		}
		
		if(gUtils._qualityOptions.mipMapping) {
			gl.generateMipmap(gl.TEXTURE_2D);
		}
		
		gl.bindTexture(gl.TEXTURE_2D, null);
	 

		// Record normalised height and width.
		var w = extent.w / gUtils.nextHighestPowerOfTwo(extent.w), h = extent.h / gUtils.nextHighestPowerOfTwo(extent.h);
		
		gUtils.srcPoints = [
			{ x: 0, y: 0 }, // top-left
			{ x: w, y: 0 }, // top-right
			{ x: 0, y: h }, // bottom-left
			{ x: w, y: h }  // bottom-right
		];
		// var	pixelOrigin = map.getPixelOrigin(),
			// wh = L.point([w, h]);
		// gUtils.srcPoints = gUtils._clipCoords.map(function(it) {
			// var p = map.project(it).subtract(pixelOrigin),
				// wh = L.point([gUtils.nextHighestPowerOfTwo(p.x), gUtils.nextHighestPowerOfTwo(p.y)]);
			// p = p.unscaleBy(wh);
			// return p;
		// });



		// setup the vertex buffer with the source points
		var vertices = [];
		for(var i=0, len = gUtils.srcPoints.length; i<len; i++) {
			vertices.push(gUtils.srcPoints[i].x);
			vertices.push(gUtils.srcPoints[i].y);
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, gUtils._glResources.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
		
		// Redraw the image
		gUtils.redrawImg();
	},
	nextHighestPowerOfTwo: function (x) {
		--x;
		for (var i = 1; i < 32; i <<= 1) {
			x = x | x >> i;
		}
		return x + 1;
	},
	_refresh: function () {
		var map = gUtils._map,
			coords = gUtils._imageAttr.drawAnchors.getLayers()[0].points.getLatLngs()[0];
		gUtils.controlPoints = [
			map.layerPointToContainerPoint(map.latLngToLayerPoint(coords[0])),
			map.layerPointToContainerPoint(map.latLngToLayerPoint(coords[1])),
			map.layerPointToContainerPoint(map.latLngToLayerPoint(coords[3])),
			map.layerPointToContainerPoint(map.latLngToLayerPoint(coords[2]))
		];
		//console.log('_refresh', gUtils.controlPoints);
		if (!gUtils.srcPoints) gUtils.loadScreenTexture();

		var pbbox = map.getPixelBounds(),
			panePos = map._getMapPanePos();
		gUtils._canvas.width = pbbox.max.x - pbbox.min.x;
		gUtils._canvas.height = pbbox.max.y - pbbox.min.y;
		gUtils._canvas.style.left = -panePos.x + 'px';
		gUtils._canvas.style.top = -panePos.y + 'px';

		gUtils.redrawImg();
	},

	redrawImg: function () {
		if(!gl || !gUtils._glResources || !gUtils.srcPoints) { return; }
		
		var vpW = gUtils._canvas.width;
		var vpH = gUtils._canvas.height;
		
		// Find where the control points are in 'window coordinates'. I.e.
		// where thecanvas covers [-1,1] x [-1,1]. Note that we have to flip
		// the y-coord.
		var dstPoints = [];
		for(var i = 0, len = gUtils.controlPoints.length; i < len; i++) {
			dstPoints.push({
				x: (2 * gUtils.controlPoints[i].x / vpW) - 1,
				y: -(2 * gUtils.controlPoints[i].y / vpH) + 1
			});
		}
		
		// Get the transform
		var v = gUtils.transformationFromQuadCorners(gUtils.srcPoints, dstPoints);
		
		// set background to full transparency
		gl.clearColor(0,0,0,0);
		gl.viewport(0, 0, vpW, vpH);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		gl.useProgram(gUtils._glResources.shaderProgram);

		// draw the triangles
		gl.bindBuffer(gl.ARRAY_BUFFER, gUtils._glResources.vertexBuffer);
		gl.enableVertexAttribArray(gUtils._glResources.vertAttrib);
		gl.vertexAttribPointer(gUtils._glResources.vertAttrib, 2, gl.FLOAT, false, 0, 0);
		
		/*  If 'v' is the vector of transform coefficients, we want to use
			the following matrix:
		
			[v[0], v[3],   0, v[6]],
			[v[1], v[4],   0, v[7]],
			[   0,    0,   1,    0],
			[v[2], v[5],   0,    1]
		
			which must be unravelled and sent to uniformMatrix4fv() in *column-major*
			order. Hence the mystical ordering of the array below.
		*/
		gl.uniformMatrix4fv(
			gUtils._glResources.transMatUniform,
			false, [
				v[0], v[1],    0, v[2],
				v[3], v[4],    0, v[5],
				   0,    0,    0,    0,
				v[6], v[7],    0,    1
			]);
			
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, gUtils._glResources.screenTexture);
		gl.uniform1i(gUtils._glResources.samplerUniform, 0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);    
	},

	transformationFromQuadCorners: function (before, after) {
		/*
		 Return the 8 elements of the transformation matrix which maps
		 the points in *before* to corresponding ones in *after*. The
		 points should be specified as
		 [{x:x1,y:y1}, {x:x2,y:y2}, {x:x3,y:y2}, {x:x4,y:y4}].
		 
		 Note: There are 8 elements because the bottom-right element is
		 assumed to be '1'.
		*/
	 
		var b = numeric.transpose([[
			after[0].x, after[0].y,
			after[1].x, after[1].y,
			after[2].x, after[2].y,
			after[3].x, after[3].y ]]);
		
		var A = [];
		for(var i=0; i<before.length; i++) {
			A.push([
				before[i].x, 0, -after[i].x*before[i].x,
				before[i].y, 0, -after[i].x*before[i].y, 1, 0]);
			A.push([
				0, before[i].x, -after[i].y*before[i].x,
				0, before[i].y, -after[i].y*before[i].y, 0, 1]);
		}
		
		// Solve for T and return the elements as a single array
		return numeric.transpose(numeric.dot(numeric.inv(A), b))[0];
	}
};

var loadImage = function() {
	gUtils._img = new Image();

	gUtils._img.onload = function(ev) {
		gUtils.createGL(gUtils._canvas);
		gUtils._map.on('move', gUtils._refresh);
	}
	gUtils._img.crossOrigin = '';
	gUtils._img.src = './examples/img/image.jpg';
};

gUtils._map
	.on('resize', function(ev) {
		//gUtils._map.off('move', gUtils._refresh);
		//gUtils.srcPoints = null;
		gUtils._refresh();
	});
loadImage();

</script>

</body>
</html>