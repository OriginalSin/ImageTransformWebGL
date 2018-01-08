(function() {
var ProjectiveImageWebGL = L.Class.extend({
    options: {
        antialias: true,
        depth: false,
        preserveDrawingBuffer: true,
        shaderVS: 'attribute vec2 aVertCoord;\
            uniform mat4 uTransformMatrix;\
            varying vec2 vTextureCoord;\
            void main(void) {\
                vTextureCoord = aVertCoord;\
                gl_Position = uTransformMatrix * vec4(aVertCoord, 0.0, 1.0);\
            }\
        ',
        shaderFS: 'precision mediump float;\
            varying vec2 vTextureCoord;\
            uniform sampler2D uSampler;\
            void main(void) {\
                gl_FragColor = texture2D(uSampler, vTextureCoord);\
            }\
        '
    },

    setOptions: function(options) {
        L.setOptions(this, options);
    },

    initialize: function(options) {
        this.setOptions(options);

        var canvas = document.createElement('canvas'),
            glOpts = {
                antialias: this.options.antialias,
                depth: this.options.depth,
                preserveDrawingBuffer: this.options.preserveDrawingBuffer
            },
            gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
        if (!gl) { return; }
        var glResources = this._setupGlContext(gl);
        if (!glResources) { return; }

        canvas.width = canvas.height = 256;
        glResources.canvas = canvas;

        this.glResources = glResources;
        this.canvas = canvas;
        this.gl = gl;
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

    _setupGlContext: function (gl) {
        // Store return values here
        var vertexShader = this._getShader(gl.VERTEX_SHADER, this.options.shaderVS, gl),
            fragmentShader = this._getShader(gl.FRAGMENT_SHADER, this.options.shaderFS, gl);

        if (vertexShader && fragmentShader) {
            // Compile the program
            var shaderProgram = gl.createProgram();
            gl.attachShader(shaderProgram, vertexShader);
            gl.attachShader(shaderProgram, fragmentShader);
            gl.linkProgram(shaderProgram);

            if (gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
                // Find and set up the uniforms and attributes
                gl.useProgram(shaderProgram);
                this.vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
                var vertexBuffer = gl.createBuffer(),    // Create a buffer to hold the vertices
                    vertAttrib = gl.getAttribLocation(shaderProgram, 'aVertCoord');
                gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STATIC_DRAW);

                // draw the triangles
                gl.enableVertexAttribArray(vertAttrib);
                gl.vertexAttribPointer(vertAttrib, 2, gl.FLOAT, false, 0, 0);
                return {
                    transMatUniform: gl.getUniformLocation(shaderProgram, 'uTransformMatrix'),
                    samplerUniform: gl.getUniformLocation(shaderProgram, 'uSampler'),
                    screenTexture: gl.createTexture() // Create a texture to use for the screen image
                };
            }
        }
        return null;
    },

    _bindTexture: function (gl, image, texture) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // gl.NEAREST is also allowed, instead of gl.LINEAR, as neither mipmap.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        // Prevents s-coordinate wrapping (repeating).
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        // Prevents t-coordinate wrapping (repeating).
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    },

    getCanvas: function (attr) {
        var p = attr.points,
            deltaX = attr.deltaX,
            deltaY = attr.deltaY,
            dstPoints = new Float32Array([
                (p[0][0] + deltaX) / 128 - 1, 1 - (p[0][1] + deltaY) / 128,
                (p[1][0] + deltaX) / 128 - 1, 1 - (p[1][1] + deltaY) / 128,
                (p[3][0] + deltaX) / 128 - 1, 1 - (p[3][1] + deltaY) / 128,
                (p[2][0] + deltaX) / 128 - 1, 1 - (p[2][1] + deltaY) / 128
            ]);

        var v = ProjectiveImageWebGL.Utils.general2DProjection(this.vertices, dstPoints),
            gl = this.gl,
            glResources = this.glResources;

        this._bindTexture(gl, attr.imageObj, glResources.screenTexture);

        gl.viewport(0, 0, 256, 256);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);    // set background to full transparency

        gl.uniformMatrix4fv(
            glResources.transMatUniform,
            false, [
                v[0], v[3],    0, v[6],
                v[1], v[4],    0, v[7],
                   0,    0,    1,    0,
                v[2], v[5],    0,    1
            ]);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glResources.screenTexture);
        gl.uniform1i(glResources.samplerUniform, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return this;
    }
});

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

function basisToPoints(p) {
    var m = [
        p[0], p[2], p[4],
        p[1], p[3], p[5],
        1,  1,  1
    ];
    var v = multmv(adj(m), [p[6], p[7], 1]);
    return multmm(m, [
        v[0], 0, 0,
        0, v[1], 0,
        0, 0, v[2]
    ]);
}

ProjectiveImageWebGL.Utils = {
    general2DProjection: function(from, to) {
        var arr = multmm(basisToPoints(to), adj(basisToPoints(from)));
        if (arr[8]) {
            for (var i = 0; i !== 9; ++i) {
                arr[i] = arr[i] / arr[8];
            }
        }
        return arr;
    },

    getWebGlResources: function(options) {
        var obj = new ProjectiveImageWebGL(options);
        return obj.gl ? obj : null;
    }
};
L.gmx.projectiveImageWebGL = function(options) {
    var res = new ProjectiveImageWebGL(options);
    return res.gl ? res : null;
};
})();
