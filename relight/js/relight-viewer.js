function Relight(gl, options) {
    var t = this;
    if (!gl) return null;
    t.gl = gl;
    t.options = Object.assign({ visible: true, opacity: 1, layout: "image", suffix: ".jpg", position: [0, 0], scale: 1, rotation: 0, light: [0, 0, 1], normals: 0, border: 1, mipmapbias: 0.5, maxRequested: 4 }, options);
    t.pos = { x: 0, y: 0, z: 0, a: 0 };
    t.normals = t.options.normals;
    if (t.url && t.url.endsWidth("/")) t.url = r.url.slice(0, -1);
    for (var i in t.options) t[i] = t.options[i];
    t.previousbox = [1, 1, -1, -1];
    t.nodes = [];
    t.lweights = [];
    t.cache = {};
    t.queued = [];
    t.requested = {};
    t.requestedCount = 0;
    t.animaterequest = null;
    t.waiting = 0;
    t._onload = [];
    if (t.img) {
        t.loadInfo({ type: "img", colorspace: null, width: 0, height: 0, nplanes: 3 });
    } else if (t.dem) {
        t.loadInfo({ type: "dem", colorspace: null, width: 0, height: 0, nplanes: 3 });
    } else if (t.url !== null) {
        t.setUrl(t.url);
    }
    return this;
}
Relight.prototype = {
    get: function (url, type, callback) {
        if (!url) throw "Missing url!";
        var r = new XMLHttpRequest();
        r.open("GET", url);
        if (type != "xml") r.responseType = type;
        r.onload = function (e) {
            if (r.readyState === 4) {
                if (r.status === 200) {
                    if (type == "xml") callback(r.responseXML);
                    else callback(r.response);
                } else {
                    console.error(r.statusText);
                }
            }
        };
        r.send();
    },
    setUrl: function (url) {
        var t = this;
        t.url = url;
        t.img = "plane_0";
        t.waiting = 1;
        if (t.layout == "webrtiviewer") {
            t.get(url + "/info.xml", "xml", function (d) {
                t.waiting--;
                t.loadWebRTIViewerInfo(d);
            });
        } else if (t.layout == "iip") {
            var url = t.server + "?FIF=" + t.url + (t.stack === true ? "" : "/plane_0.tif") + "&OBJ=xmp";
            t.get(url, "json", function (d) {
                t.waiting--;
                t.loadInfo(d);
            });
        } else {
            t.get(url + "/info.json", "json", function (d) {
                t.waiting--;
                t.loadInfo(d);
            });
        }
    },
    loadInfo: function (info) {
        var t = this;
        t.type = info.type;
        t.colorspace = info.colorspace;
        t.width = parseInt(info.width);
        t.height = parseInt(info.height);
        if (t.colorspace == "mycc") {
            t.yccplanes = info.yccplanes;
            t.nplanes = t.yccplanes[0] + t.yccplanes[1] + t.yccplanes[2];
        } else {
            t.yccplanes = [0, 0, 0];
            t.nplanes = info.nplanes;
        }
        t.planes = [];
        t.njpegs = 0;
        while (t.njpegs * 3 < t.nplanes) t.njpegs++;
        if (t.type == "img" || t.type == "dem") {
            t.initTree();
            t.loadProgram();
            t.loaded();
            return;
        }
        t.nmaterials = info.materials.length;
        t.materials = info.materials;
        if (info.lights) {
            t.lights = new Float32Array(info.lights.length);
            for (var i = 0; i < t.lights.length; i++) t.lights[i] = info.lights[i];
        }
        if (t.type == "rbf") {
            t.sigma = info.sigma;
            t.ndimensions = t.lights.length / 3;
        }
        if (t.type == "bilinear") {
            t.resolution = info.resolution;
            t.ndimensions = t.resolution * t.resolution;
        }
        t.factor = new Float32Array((t.nplanes + 1) * t.nmaterials);
        t.bias = new Float32Array((t.nplanes + 1) * t.nmaterials);
        for (var m = 0; m < t.nmaterials; m++) {
            for (var p = 1; p < t.nplanes + 1; p++) {
                t.factor[m * (t.nplanes + 1) + p] = t.materials[m].scale[p - 1];
                t.bias[m * (t.nplanes + 1) + p] = t.materials[m].bias[p - 1];
            }
        }
        t.initTree();
        t.loadProgram();
        if (t.colorspace == "mrgb" || t.colorspace == "mycc") {
            if (info.basis) {
                t.loadBasis(info.basis);
            } else {
                t.waiting++;
                t.get(t.url + "/materials.bin", "arraybuffer", function (d) {
                    t.waiting--;
                    t.loadBasis(d);
                    t.loaded();
                });
            }
        }
        t.loaded();
    },
    loadWebRTIViewerInfo: function (info) {
        var t = this;
        t.format = "jpg";
        var val = parseInt(info.getElementsByTagName("MultiRes")[0].getAttribute("format"));
        if (!isNaN(val)) {
            if (val == 1) {
                t.format = "png";
            }
        }
        var content = info.getElementsByTagName("Content")[0];
        var type = content.getAttribute("type");
        switch (type) {
            case "HSH_RTI":
                t.type = "hsh";
                t.colorspace = "rgb";
                break;
            case "RGB_PTM":
                t.type = "ptm";
                t.colorspace = "rgb";
                break;
            case "LRGB_PTM":
                t.type = "ptm";
                t.colorspace = "lrgb";
                break;
            case "IMAGE":
                t.type = "img";
                t.colorspace = "rgb";
                break;
            default:
                console.log("Unrecognized type", type);
                return;
        }
        var size = info.getElementsByTagName("Size")[0];
        t.imgWidth = parseInt(size.getAttribute("width"));
        t.imgHeight = parseInt(size.getAttribute("height"));
        var ordlen = parseInt(size.getAttribute("coefficients"));
        t.nplanes = 3 * ordlen;
        if (t.colorspace == "lrgb") {
            t.nplanes = ordlen + 3;
        }
        t.njpegs = 0;
        while (t.njpegs * 3 < t.nplanes) {
            t.njpegs++;
        }
        t.planes = [];
        console.log("type", t.type, "colorspace", t.colorspace, "format", t.format, "imgWidth", t.imgWidth, "imgHeight", t.imgHeight, "nplanes", t.nplanes, "njpegs", t.njpegs);
        t.yccplanes = [0, 0, 0];
        t.nmaterials = 1;
        t.factor = new Float32Array(t.nplanes + 1);
        t.bias = new Float32Array(t.nplanes + 1);
        var scale = info.getElementsByTagName("Scale")[0];
        var scale_tokens = scale.childNodes[0].nodeValue.split(" ");
        if (scale_tokens.length < ordlen) return;
        var bias = info.getElementsByTagName("Bias")[0];
        var bias_tokens = bias.childNodes[0].nodeValue.split(" ");
        if (bias_tokens.length < ordlen) return;
        if (t.colorspace == "lrgb") {
            t.factor[1] = t.factor[2] = t.factor[3] = 1;
            t.bias[1] = t.bias[2] = t.bias[3] = 0;
        }
        for (var j = 0; j < ordlen; j++) {
            var ffactor = parseFloat(scale_tokens[j]);
            var fbias = parseFloat(bias_tokens[j]);
            if (t.colorspace == "lrgb") {
                var pos = 4 + j;
                t.bias[pos] = fbias / 255;
                t.factor[pos] = ffactor;
            } else {
                for (var k = 0; k < 3; k++) {
                    var pos = 1 + 3 * j + k;
                    if (t.type == "hsh") {
                        var tbias = ffactor;
                        var tfactor = fbias;
                        t.bias[pos] = -tbias / tfactor;
                        t.factor[pos] = tfactor;
                    } else {
                        t.bias[pos] = fbias / 255;
                        t.factor[pos] = ffactor;
                    }
                }
            }
        }
        function sglGetLines(text) {
            var allLines = text.split("\n");
            var n = allLines.length;
            var lines = [];
            var line = null;
            for (var i = 0; i < n; ++i) {
                line = allLines[i].replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
                if (line.length > 0) {
                    lines.push(line);
                }
            }
            return lines;
        }
        var tree = info.getElementsByTagName("Tree")[0];
        var tree_content = tree.textContent;
        var lines = sglGetLines(tree_content);
        var n = lines.length;
        var tokens = null;
        var i = 0;
        if (n <= 1) return;
        tokens = lines[i++].split(" ");
        if (tokens.length < 2) return;
        var nodesCount = parseInt(tokens[0]);
        if (nodesCount <= 0) return;
        var rootIndex = parseInt(tokens[1]);
        if (rootIndex < 0 || rootIndex >= nodesCount) return;
        if (n <= i) return;
        tokens = lines[i++].split(" ");
        if (tokens.length < 1) return;
        var tileSize = parseInt(tokens[0]);
        if (tileSize <= 0) return;
        if (n <= i) return;
        tokens = lines[i++].split(" ");
        if (tokens.length < 3) return;
        var whd = [1, 1, 1];
        whd[0] = parseFloat(tokens[0]);
        whd[1] = parseFloat(tokens[1]);
        whd[2] = parseFloat(tokens[2]);
        if (n <= i) return;
        tokens = lines[i++].split(" ");
        if (tokens.length < 3) return;
        var offset = [0, 0, 0];
        offset[0] = parseFloat(tokens[0]);
        offset[1] = parseFloat(tokens[1]);
        offset[2] = parseFloat(tokens[2]);
        t.tilesize = tileSize;
        t.width = whd[0];
        t.height = whd[1];
        t.tindex = [];
        function addToTIndex(ilevel, x, y, id) {
            if (t.tindex[ilevel] === undefined) {
                t.tindex[ilevel] = [];
            }
            if (t.tindex[ilevel][x] === undefined) {
                t.tindex[ilevel][x] = [];
            }
            t.tindex[ilevel][x][y] = id;
        }
        t.nlevels = 1;
        var temp = t.width;
        var nlpow2 = 1;
        while (temp > t.tilesize) {
            t.nlevels++;
            temp /= 2;
            nlpow2 *= 2;
        }
        dx2ilevel = [];
        temp = 1;
        for (var k = 0; k < t.nlevels; k++) {
            dx2ilevel[temp * nlpow2] = k;
            temp /= 2;
        }
        if (n > i) {
            var maxid = 0;
            var minlevel = 1e3;
            var maxlevel = -1;
            for (var k = 0; k < nodesCount; k++) {
                tokens = lines[i++].split(" ");
                if (tokens.length < 14) return;
                var id = parseInt(tokens[0]);
                if (id <= 0) return;
                var xmin = parseFloat(tokens[8]);
                var ymin = parseFloat(tokens[9]);
                var xmax = parseFloat(tokens[11]);
                var ymax = parseFloat(tokens[12]);
                var dx = xmax - xmin;
                var ilevel = dx2ilevel[dx * nlpow2];
                if (typeof ilevel == "undefined") {
                    console.log("problem in tile", id);
                    continue;
                }
                minlevel = Math.min(minlevel, ilevel);
                maxlevel = Math.max(maxlevel, ilevel);
                var x = xmin / dx;
                var y = (1 - ymax) / dx;
                addToTIndex(ilevel, x, y, id);
            }
        } else {
            var index2info = [];
            var index = 0;
            var count = 1;
            for (var k = 0; k < t.nlevels; k++) {
                for (var s = 0; s < count; s++) {
                    var parentIndex = -1;
                    if (index > 0) {
                        parentIndex = Math.ceil(index / 4) - 1;
                    }
                    var id = index + 1;
                    var x = 0;
                    var y = 0;
                    if (index > 0) {
                        var u = index % 4;
                        x = 2 * index2info[parentIndex].x;
                        y = 2 * index2info[parentIndex].y;
                        switch (u) {
                            case 0:
                                x++;
                                y++;
                                break;
                            case 1:
                                break;
                            case 2:
                                x++;
                                break;
                            case 3:
                                y++;
                                break;
                        }
                    }
                    addToTIndex(k, x, y, id);
                    index2info[index] = { x: x, y: y };
                    index++;
                }
                count *= 4;
            }
        }
        t.initTree();
        t.loadProgram();
        t.loaded();
    },
    onLoad: function (f) {
        this._onload.push(f);
    },
    loaded: function () {
        var t = this;
        if (t.waiting) return;
        t._onload.forEach((f) => {
            f();
        });
        t.computeLightWeights(t.light);
    },
    initTree: function () {
        var t = this;
        if (t.imgCache) {
            for (var i = 0; i < t.imgCache.length; i++) t.imgCache[i].src = "";
        } else {
            t.imgCache = [];
            for (var i = 0; i < t.maxRequested * t.njpegs; i++) {
                var image = new Image();
                image.crossOrigin = "";
                t.imgCache[i] = image;
            }
        }
        t.currImgCache = 0;
        t.flush();
        t.nodes = [];
        switch (t.layout) {
            case "webrtiviewer":
                t.getTileURL = function (image, x, y, level) {
                    var ppts = image.split(".");
                    var ext = ppts[1];
                    var plane = parseInt(ppts[0].split("_")[1]);
                    if (plane < 0) return;
                    if (t.colorspace == "lrgb") {
                        plane = (plane + 2) % 3;
                    }
                    plane += 1;
                    var ilevel = t.nlevels - 1 - level;
                    var id = t.tindex[ilevel][x][y];
                    var nimage = `${id}_${plane}.${ext}`;
                    if (t.url) return t.url + "/" + nimage;
                    else return nimage;
                };
                break;
            case "image":
                t.nlevels = 1;
                t.tilesize = 0;
                t.qbox = [[0, 0, 1, 1]];
                t.bbox = [[0, 0, t.width, t.height]];
                t.getTileURL = function (image, x, y, level) {
                    if (t.url) return t.url + "/" + image;
                    else return image;
                };
                t.nodes[0] = { tex: [], missing: t.njpegs };
                return;
            case "google":
                t.tilesize = 256;
                t.overlap = 0;
                var max = Math.max(t.width, t.height) / t.tilesize;
                t.nlevels = Math.ceil(Math.log(max) / Math.LN2) + 1;
                t.getTileURL = function (image, x, y, level) {
                    var prefix = image.substr(0, image.lastIndexOf("."));
                    var base = t.url + "/" + prefix;
                    var ilevel = parseInt(t.nlevels - 1 - level);
                    return base + "/" + ilevel + "/" + y + "/" + x + t.suffix;
                };
                break;
            case "deepzoom":
                t.metaDataURL = t.url + "/" + t.img + ".dzi";
                t.getTileURL = function (image, x, y, level) {
                    var prefix = image.substr(0, image.lastIndexOf("."));
                    var base = t.url + "/" + prefix + "_files/";
                    var ilevel = parseInt(t.nlevels - 1 - level);
                    return base + ilevel + "/" + x + "_" + y + t.suffix;
                };
                t.parseMetaData = function (response) {
                    t.suffix = "." + /Format="(\w+)/.exec(response)[1];
                    t.tilesize = parseInt(/TileSize="(\d+)/.exec(response)[1]);
                    t.overlap = parseInt(/Overlap="(\d+)/.exec(response)[1]);
                    if (!t.width) t.width = parseInt(/Width="(\d+)/.exec(response)[1]);
                    if (!t.height) t.height = parseInt(/Height="(\d+)/.exec(response)[1]);
                    var max = Math.max(t.width, t.height) / t.tilesize;
                    t.nlevels = Math.ceil(Math.log(max) / Math.LN2) + 1;
                };
                break;
            case "zoomify":
                t.overlap = 0;
                t.metaDataURL = t.url + "/" + t.img + "/ImageProperties.xml";
                t.getTileURL = function (image, x, y, level) {
                    var prefix = image.substr(0, image.lastIndexOf("."));
                    var base = t.url + "/" + prefix;
                    var ilevel = parseInt(t.nlevels - 1 - level);
                    var index = t.index(level, x, y) >>> 0;
                    var group = index >> 8;
                    return base + "/TileGroup" + group + "/" + ilevel + "-" + x + "-" + y + t.suffix;
                };
                t.parseMetaData = function (response) {
                    var tmp = response.split('"');
                    t.tilesize = parseInt(tmp[11]);
                    var max = Math.max(t.width, t.height) / t.tilesize;
                    t.nlevels = Math.ceil(Math.log(max) / Math.LN2) + 1;
                };
                break;
            case "iip":
                t.suffix = ".tif";
                t.overlap = 0;
                t.metaDataURL = t.server + "?FIF=" + (t.stack === true ? t.url : t.url + "/" + t.img + t.suffix) + "&obj=Max-size&obj=Tile-size&obj=Resolution-number";
                t.parseMetaData = function (response) {
                    var tmp = response.split("Tile-size:");
                    if (!tmp[1]) return null;
                    t.tilesize = parseInt(tmp[1].split(" ")[0]);
                    tmp = response.split("Max-size:");
                    if (!tmp[1]) return null;
                    tmp = tmp[1].split("\n")[0].split(" ");
                    t.width = parseInt(tmp[0]);
                    t.height = parseInt(tmp[1]);
                    t.nlevels = parseInt(response.split("Resolution-number:")[1]);
                };
                t.getTileURL = function (image, x, y, level) {
                    var prefix = image.substr(0, image.lastIndexOf("."));
                    var plane = parseInt(prefix.split("_")[1]);
                    var index = y * t.qbox[level][2] + x;
                    var ilevel = parseInt(t.nlevels - 1 - level);
                    var img = t.stack === true ? t.url + "&SDS=" + plane : t.url + "/" + prefix + t.suffix;
                    var url = t.server + "?FIF=" + img + "&JTL=" + ilevel + "," + index;
                    return url;
                };
                break;
            case "iiif":
                t.metaDataURL = t.server + "?IIIF=" + t.path + "/" + t.img + "/info.json";
                t.parseMetaData = function (response) {
                    var info = JSON.parse(response);
                    t.width = info.width;
                    t.height = info.height;
                    t.nlevels = info.tiles[0].scaleFactors.length;
                    t.tilesize = info.tiles[0].width;
                };
                t.getTileURL = function (image, x, y, level) {
                    let tw = t.tilesize;
                    let ilevel = parseInt(t.nlevels - 1 - level);
                    let s = Math.pow(2, level);
                    let xr = x * tw * s;
                    let yr = y * tw * s;
                    let wr = Math.min(tw * s, t.width - xr);
                    let hr = Math.min(tw * s, t.height - yr);
                    let ws = tw;
                    if (xr + tw * s > t.width) ws = (t.width - xr + s - 1) / s;
                    let hs = tw;
                    if (yr + tw * s > t.height) hs = (t.height - yr + s - 1) / s;
                    return t.server + `?IIIF=${t.path}/${t.img}/${xr},${yr},${wr},${hr}/${ws},${hs}/0/default.jpg`;
                };
                break;
            default:
                console.log("OOOPPpppps");
        }
        if (t.metaDataURL) {
            t.waiting++;
            t.get(t.metaDataURL, "text", function (r) {
                t.waiting--;
                t.parseMetaData(r);
                initBoxes();
                t.loaded();
            });
        } else initBoxes();
        function initBoxes() {
            t.qbox = [];
            t.bbox = [];
            var w = t.width;
            var h = t.height;
            var count = 0;
            for (var level = t.nlevels - 1; level >= 0; level--) {
                var ilevel = t.nlevels - 1 - level;
                t.qbox[ilevel] = [0, 0, 0, 0];
                t.bbox[ilevel] = [0, 0, w, h];
                for (var y = 0; y * t.tilesize < h; y++) {
                    t.qbox[ilevel][3] = y + 1;
                    for (var x = 0; x * t.tilesize < w; x++) {
                        t.nodes[count++] = { tex: [], missing: t.njpegs };
                        t.qbox[ilevel][2] = x + 1;
                    }
                }
                w >>>= 1;
                h >>>= 1;
            }
        }
    },
    rot: function (dx, dy, a) {
        var a = Math.PI * (a / 180);
        var x = Math.cos(a) * dx + Math.sin(a) * dy;
        var y = -Math.sin(a) * dx + Math.cos(a) * dy;
        return [x, y];
    },
    project: function (pos, x, y) {
        var t = this;
        var z = Math.pow(2, pos.z);
        var r = t.rot(x - t.width / 2, y - t.height / 2, pos.a);
        r[0] = (r[0] - pos.x) / z;
        r[1] = (r[1] - pos.y) / z;
        return r;
    },
    iproject: function (pos, x, y) {
        var t = this;
        var z = Math.pow(2, pos.z);
        var r = t.rot(x * z + pos.x, y * z + pos.y, pos.a);
        r[0] += t.width / 2;
        r[1] += t.height / 2;
        return r;
    },
    getBox: function (pos) {
        var t = this;
        var corners = [0, 0, 0, 1, 1, 1, 1, 0];
        var box = [1e20, 1e20, -1e20, -1e20];
        for (var i = 0; i < 8; i += 2) {
            var p = t.project(pos, corners[i] * t.width, corners[i + 1] * t.height);
            box[0] = Math.min(p[0], box[0]);
            box[1] = Math.min(p[1], box[1]);
            box[2] = Math.max(p[0], box[2]);
            box[3] = Math.max(p[1], box[3]);
        }
        return box;
    },
    getIBox: function (pos) {
        var t = this;
        var corners = [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5];
        var box = [1e20, 1e20, -1e20, -1e20];
        for (var i = 0; i < 8; i += 2) {
            var p = t.iproject(pos, corners[i] * t.canvas.width, corners[i + 1] * t.canvas.height);
            box[0] = Math.min(p[0], box[0]);
            box[1] = Math.min(p[1], box[1]);
            box[2] = Math.max(p[0], box[2]);
            box[3] = Math.max(p[1], box[3]);
        }
        return box;
    },
    basePixelOffset: function (m, p, x, y, k) {
        var t = this;
        return ((m * (t.nplanes + 1) + p) * t.resolution * t.resolution + (x + y * t.resolution)) * 3 + k;
    },
    baseLightOffset: function (m, p, l, k) {
        var t = this;
        return ((m * (t.nplanes + 1) + p) * t.ndimensions + l) * 3 + k;
    },
    loadBasis: function (data) {
        var t = this;
        var tmp = new Uint8Array(data);
        t.basis = new Float32Array(tmp.length);
        for (var m = 0; m < t.nmaterials; m++) {
            for (var p = 0; p < t.nplanes + 1; p++) {
                for (var c = 0; c < t.ndimensions; c++) {
                    for (var k = 0; k < 3; k++) {
                        var o = t.baseLightOffset(m, p, c, k);
                        if (p == 0) t.basis[o] = tmp[o] / 255;
                        else t.basis[o] = (tmp[o] - 127) / t.materials[m].range[p - 1];
                    }
                }
            }
        }
    },
    index: function (level, x, y) {
        var t = this;
        var startindex = 0;
        for (var i = t.nlevels - 1; i > level; i--) {
            startindex += t.qbox[i][2] * t.qbox[i][3];
        }
        return startindex + y * t.qbox[level][2] + x;
    },
    loadTile: function (level, x, y) {
        var t = this;
        var index = t.index(level, x, y);
        if (t.requested[index]) {
            console.log("AAARRGGHHH double request!");
            return;
        }
        t.requested[index] = true;
        t.requestedCount++;
        for (var p = 0; p < t.njpegs; p++) t.loadComponent(p, index, level, x, y);
    },
    loadComponent: function (plane, index, level, x, y) {
        var t = this;
        var gl = t.gl;
        if (t.type == "img") var name = t.img;
        else if (t.type == "dem") var name = t.dem;
        else var name = "plane_" + plane + ".jpg";
        var image = t.imgCache[t.currImgCache++];
        if (t.currImgCache >= t.imgCache.length) t.currImgCache = 0;
        image.src = t.getTileURL(name, x, y, level);
        image.onload = function () {
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
            t.nodes[index].tex[plane] = tex;
            t.nodes[index].missing--;
            if (t.nodes[index].missing == 0) {
                delete t.requested[index];
                t.requestedCount--;
                t.preload();
                t.redraw();
            }
            if (t.layout == "image") {
                t.width = image.width;
                t.height = image.height;
                t.loaded();
            }
        };
        image.onerror = function () {
            t.nodes[index].missing = -1;
            delete t.requested[index];
            t.requestedCount--;
            t.preload();
        };
    },
    flush: function () {
        var t = this;
        if (!t.nodes) return;
        for (var i = 0; i < t.nodes.length; i++) {
            var node = t.nodes[i];
            for (var j = 0; j < node.tex.length; j++) t.gl.deleteTexture(node.tex[j]);
        }
        t.previouslevel = null;
        t.previousbox = [1, 1, -1, -1];
        for (var i = 0; i < t.imgCache.length; i++) {
            var img = t.imgCache[i];
            img.onload = null;
            img.onerror = null;
        }
        t.requested = {};
        t.requestedCount = 0;
    },
    setNormals: function (on) {
        var t = this;
        if (on === undefined) t.normals = (t.normals + 1) % 3;
        else t.normals = Number(on);
        t.loadProgram();
        t.computeLightWeights(t.light);
        t.redraw();
    },
    computeLightWeights: function (lpos) {
        var t = this;
        var l = t.rot(lpos[0], lpos[1], -t.pos.a);
        l[2] = lpos[2];
        if (t.waiting) return;
        var lightFun;
        switch (t.type) {
            case "img":
                return;
            case "dem":
                t.gl.uniform3f(t.lightLocation, l[0], l[1], l[2]);
                return;
            case "rbf":
                lightFun = t.computeLightWeightsRbf;
                break;
            case "bilinear":
                lightFun = t.computeLightWeightsOcta;
                break;
            case "ptm":
                lightFun = t.computeLightWeightsPtm;
                break;
            case "hsh":
                lightFun = t.computeLightWeightsHsh;
                break;
            default:
                console.log("Unknown basis", t.type);
        }
        lightFun.call(this, l);
        var uniformer = t.colorspace == "mrgb" || t.colorspace == "mycc" ? t.gl.uniform3fv : t.gl.uniform1fv;
        t.gl.useProgram(t.program);
        if (t.baseLocation0) {
            lightFun.call(this, [0.612, 0.354, 0.707]);
            uniformer.call(t.gl, t.baseLocation0, t.lweights);
        }
        if (t.baseLocation1) {
            lightFun.call(this, [-0.612, 0.354, 0.707]);
            uniformer.call(t.gl, t.baseLocation1, t.lweights);
        }
        if (t.baseLocation2) {
            lightFun.call(this, [0, -0.707, 0.707]);
            uniformer.call(t.gl, t.baseLocation2, t.lweights);
        }
        if (t.baseLocation) {
            uniformer.call(t.gl, t.baseLocation, t.lweights);
        }
        if (t.lightLocation) {
            t.gl.uniform3fv(t.lightLocation, l);
        }
    },
    computeLightWeightsPtm: function (v) {
        var t = this;
        var w = [];
        if (t.layout == "webrtiviewer") {
            w = [v[0] * v[0], v[1] * v[1], v[0] * v[1], v[0], v[1], 1, 0, 0, 0];
        } else {
            w = [1, v[0], v[1], v[0] * v[0], v[0] * v[1], v[1] * v[1], 0, 0, 0];
        }
        t.lweights = new Float32Array(t.nplanes);
        for (var p = 0; p < w.length; p++) t.lweights[p] = w[p];
    },
    computeLightWeightsHsh: function (v) {
        var t = this;
        var M_PI = 3.1415;
        var phi = Math.atan2(v[1], v[0]);
        if (phi < 0) phi = 2 * M_PI + phi;
        var theta = Math.min(Math.acos(v[2]), M_PI / 2 - 0.5);
        var cosP = Math.cos(phi);
        var cosT = Math.cos(theta);
        var cosT2 = cosT * cosT;
        var w = new Float32Array(9);
        w[0] = 1 / Math.sqrt(2 * M_PI);
        w[1] = Math.sqrt(6 / M_PI) * (cosP * Math.sqrt(cosT - cosT2));
        w[2] = Math.sqrt(3 / (2 * M_PI)) * (-1 + 2 * cosT);
        w[3] = Math.sqrt(6 / M_PI) * (Math.sqrt(cosT - cosT2) * Math.sin(phi));
        w[4] = Math.sqrt(30 / M_PI) * (Math.cos(2 * phi) * (-cosT + cosT2));
        w[5] = Math.sqrt(30 / M_PI) * (cosP * (-1 + 2 * cosT) * Math.sqrt(cosT - cosT2));
        w[6] = Math.sqrt(5 / (2 * M_PI)) * (1 - 6 * cosT + 6 * cosT2);
        w[7] = Math.sqrt(30 / M_PI) * ((-1 + 2 * cosT) * Math.sqrt(cosT - cosT2) * Math.sin(phi));
        w[8] = Math.sqrt(30 / M_PI) * ((-cosT + cosT2) * Math.sin(2 * phi));
        t.lweights = w;
    },
    computeLightWeightsRbf: function (lpos) {
        var t = this;
        var nm = t.nmaterials;
        var np = t.nplanes;
        var radius = 1 / (t.sigma * t.sigma);
        var weights = new Array(t.ndimensions);
        var totw = 0;
        for (var i = 0; i < weights.length; i++) {
            var dx = t.lights[i * 3 + 0] - lpos[0];
            var dy = t.lights[i * 3 + 1] - lpos[1];
            var dz = t.lights[i * 3 + 2] - lpos[2];
            var d2 = dx * dx + dy * dy + dz * dz;
            var w = Math.exp(-radius * d2);
            weights[i] = [i, w];
            totw += w;
        }
        for (var i = 0; i < weights.length; i++) weights[i][1] /= totw;
        var count = 0;
        totw = 0;
        for (var i = 0; i < weights.length; i++)
            if (weights[i][1] > 0.001) {
                weights[count++] = weights[i];
                totw += weights[i][1];
            }
        weights = weights.slice(0, count);
        for (var i = 0; i < weights.length; i++) weights[i][1] /= totw;
        t.lweights = new Float32Array(nm * (np + 1) * 3);
        for (var m = 0; m < nm; m++) {
            for (var p = 0; p < np + 1; p++) {
                for (var k = 0; k < 3; k++) {
                    for (var l = 0; l < weights.length; l++) {
                        var o = t.baseLightOffset(m, p, weights[l][0], k);
                        t.lweights[3 * (m * (np + 1) + p) + k] += weights[l][1] * t.basis[o];
                    }
                }
            }
        }
    },
    computeLightWeightsOcta: function (lpos) {
        var t = this;
        var nm = t.nmaterials;
        var np = t.nplanes;
        var s = Math.abs(lpos[0]) + Math.abs(lpos[1]) + Math.abs(lpos[2]);
        var x = (lpos[0] + lpos[1]) / s;
        var y = (lpos[1] - lpos[0]) / s;
        x = (x + 1) / 2;
        y = (y + 1) / 2;
        x = x * (t.resolution - 1);
        y = y * (t.resolution - 1);
        var sx = Math.min(t.resolution - 2, Math.max(0, Math.floor(x)));
        var sy = Math.min(t.resolution - 2, Math.max(0, Math.floor(y)));
        var dx = x - sx;
        var dy = y - sy;
        var s00 = (1 - dx) * (1 - dy);
        var s10 = dx * (1 - dy);
        var s01 = (1 - dx) * dy;
        var s11 = dx * dy;
        t.lweights = new Float32Array(nm * (np + 1) * 3);
        for (var m = 0; m < nm; m++) {
            for (var p = 0; p < np + 1; p++) {
                for (var k = 0; k < 3; k++) {
                    var o00 = t.basePixelOffset(m, p, sx, sy, k);
                    t.lweights[3 * (m * (np + 1) + p) + k] += s00 * t.basis[o00];
                    var o10 = t.basePixelOffset(m, p, sx + 1, sy, k);
                    t.lweights[3 * (m * (np + 1) + p) + k] += s10 * t.basis[o10];
                    var o01 = t.basePixelOffset(m, p, sx, sy + 1, k);
                    t.lweights[3 * (m * (np + 1) + p) + k] += s01 * t.basis[o01];
                    var o11 = t.basePixelOffset(m, p, sx + 1, sy + 1, k);
                    t.lweights[3 * (m * (np + 1) + p) + k] += s11 * t.basis[o11];
                }
            }
        }
    },
    setLight: function (x, y, z) {
        var t = this;
        var r = Math.sqrt(x * x + y * y + z * z);
        t.light = [x / r, y / r, z / r];
        t.computeLightWeights(t.light);
        this.redraw();
    },
    loadProgram: function () {
        var t = this;
        t.setupShaders();
        var gl = t.gl;
        t.vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(t.vertShader, t.vertCode);
        gl.compileShader(t.vertShader);
        compiled = gl.getShaderParameter(t.vertShader, gl.COMPILE_STATUS);
        if (!compiled) {
            alert("Failed vertex shader compilation: see console log and ask for support.");
            console.log(t.vertShader);
            console.log(gl.getShaderInfoLog(t.vertShader));
        }
        t.fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(t.fragShader, t.fragCode);
        gl.compileShader(t.fragShader);
        compiled = gl.getShaderParameter(t.fragShader, gl.COMPILE_STATUS);
        if (!compiled) {
            alert("Failed fragment shader compilation: see console log and ask for support.");
            console.log(t.fragCode);
            console.log(gl.getShaderInfoLog(t.fragShader));
        }
        t.program = gl.createProgram();
        gl.attachShader(t.program, t.vertShader);
        gl.attachShader(t.program, t.fragShader);
        gl.linkProgram(t.program);
        gl.useProgram(t.program);
        if (t.colorspace) {
            t.baseLocation0 = gl.getUniformLocation(t.program, "base0");
            t.baseLocation1 = gl.getUniformLocation(t.program, "base1");
            t.baseLocation2 = gl.getUniformLocation(t.program, "base2");
            t.baseLocation = gl.getUniformLocation(t.program, "base");
            t.planesLocations = gl.getUniformLocation(t.program, "planes");
            gl.uniform1fv(gl.getUniformLocation(t.program, "scale"), t.factor);
            gl.uniform1fv(gl.getUniformLocation(t.program, "bias"), t.bias);
        }
        t.ibuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, t.ibuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([3, 2, 1, 3, 1, 0]), gl.STATIC_DRAW);
        t.vbuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, t.vbuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]), gl.STATIC_DRAW);
        t.coordattrib = gl.getAttribLocation(t.program, "a_position");
        gl.vertexAttribPointer(t.coordattrib, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(t.coordattrib);
        t.tbuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, t.tbuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]), gl.STATIC_DRAW);
        t.texattrib = gl.getAttribLocation(t.program, "a_texcoord");
        gl.vertexAttribPointer(t.texattrib, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(t.texattrib);
        t.lightLocation = gl.getUniformLocation(t.program, "light");
        t.opacitylocation = gl.getUniformLocation(t.program, "opacity");
        var sampler = gl.getUniformLocation(t.program, "planes");
        var samplerArray = new Int32Array(t.njpegs);
        var len = samplerArray.length;
        while (len--) samplerArray[len] = len;
        gl.uniform1iv(sampler, samplerArray);
    },
    drawNode: function (pos, minlevel, level, x, y) {
        var t = this;
        var index = t.index(level, x, y);
        if (this.nodes[index].missing != 0) return;
        var z = Math.pow(2, pos.z);
        var a = (Math.PI * pos.a) / 180;
        var c = Math.cos(a);
        var s = Math.sin(a);
        var coords = new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
        var tcoords = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]);
        var sx = 2 / t.canvas.width;
        var sy = 2 / t.canvas.height;
        if (t.layout == "image") {
            for (var i = 0; i < coords.length; i += 3) {
                var r = t.rot(coords[i] * t.width - t.width / 2, -coords[i + 1] * t.height + t.height / 2, pos.a);
                coords[i] = ((r[0] - pos.x) * sx) / z;
                coords[i + 1] = ((r[1] + pos.y) * sy) / z;
            }
        } else {
            var side = (tilesizeinimgspace = t.tilesize * (1 << level));
            var tx = side;
            var ty = side;
            if (t.layout != "google") {
                if (side * (x + 1) > t.width) {
                    tx = t.width - side * x;
                }
                if (side * (y + 1) > t.height) {
                    ty = t.height - side * y;
                }
            }
            var over = t.overlap;
            var lx = t.qbox[level][2] - 1;
            var ly = t.qbox[level][3] - 1;
            if (over) {
                var dtx = over / (tx / (1 << level) + (x == 0 ? 0 : over) + (x == lx ? 0 : over));
                var dty = over / (ty / (1 << level) + (y == 0 ? 0 : over) + (y == ly ? 0 : over));
                tcoords[0] = tcoords[2] = x == 0 ? 0 : dtx;
                tcoords[1] = tcoords[7] = y == 0 ? 0 : dty;
                tcoords[4] = tcoords[6] = x == lx ? 1 : 1 - dtx;
                tcoords[3] = tcoords[5] = y == ly ? 1 : 1 - dty;
            }
            for (var i = 0; i < coords.length; i += 3) {
                var r = t.rot(coords[i] * tx + side * x - t.width / 2, -coords[i + 1] * ty - side * y + t.height / 2, pos.a);
                coords[i] = ((r[0] - pos.x) * sx) / z;
                coords[i + 1] = ((r[1] + pos.y) * sy) / z;
            }
        }
        var gl = t.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, t.vbuffer);
        gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
        gl.vertexAttribPointer(t.coordattrib, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(t.coordattrib);
        gl.bindBuffer(gl.ARRAY_BUFFER, t.tbuffer);
        gl.bufferData(gl.ARRAY_BUFFER, tcoords, gl.STATIC_DRAW);
        gl.vertexAttribPointer(t.texattrib, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(t.texattrib);
        for (var i = 0; i < t.njpegs; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, t.nodes[index].tex[i]);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    },
    draw: function (pos) {
        var t = this;
        var gl = t.gl;
        if (t.waiting || !t.visible) return;
        var needed = t.neededBox(pos, 0);
        var minlevel = needed.level;
        var ilevel = t.nlevels - 1 - minlevel;
        var scale = Math.pow(2, pos.z);
        var box = [t.canvas.width / 2 - pos.x, t.canvas.height / 2 - (t.height / scale - pos.y), t.width / scale, t.height / scale];
        if (t.layout == "google") {
            box[0] += 1;
            box[1] += 1;
            box[2] -= 2;
            box[3] -= 2;
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        gl.useProgram(t.program);
        gl.uniform1f(t.opacitylocation, t.opacity);
        var torender = {};
        var brothers = {};
        var box = needed.box[minlevel];
        for (var y = box[1]; y < box[3]; y++) {
            for (var x = box[0]; x < box[2]; x++) {
                var level = minlevel;
                while (level < t.nlevels) {
                    var d = level - minlevel;
                    var index = t.index(level, x >> d, y >> d);
                    if (t.nodes[index].missing == 0) {
                        torender[index] = [level, x >> d, y >> d];
                        break;
                    } else {
                        var sx = (x >> (d + 1)) << 1;
                        var sy = (y >> (d + 1)) << 1;
                        brothers[t.index(level, sx, sy)] = 1;
                        brothers[t.index(level, sx + 1, sy)] = 1;
                        brothers[t.index(level, sx + 1, sy + 1)] = 1;
                        brothers[t.index(level, sx, sy + 1)] = 1;
                    }
                    level++;
                }
            }
        }
        for (var index in torender) {
            var id = torender[index];
            if (t.opacity != 1 && brothers[index]) continue;
            var level = id[0];
            var x = id[1];
            var y = id[2];
            t.drawNode(pos, minlevel, level, x, y);
        }
        gl.disable(gl.BLEND);
    },
    redraw: function () {},
    prefetch: function () {
        var t = this;
        if (t.waiting || !t.visible) return;
        var needed = t.neededBox(t.pos, t.border);
        var minlevel = needed.level;
        var box = needed.box[minlevel];
        if (t.previouslevel == minlevel && box[0] == t.previousbox[0] && box[1] == t.previousbox[1] && box[2] == t.previousbox[2] && box[3] == t.previousbox[3]) return;
        t.previouslevel = minlevel;
        t.previousbox = box;
        t.queued = [];
        for (var level = t.nlevels - 1; level >= minlevel; level--) {
            var box = needed.box[level];
            var tmp = [];
            for (var y = box[1]; y < box[3]; y++) {
                for (var x = box[0]; x < box[2]; x++) {
                    var index = t.index(level, x, y);
                    if (t.nodes[index].missing != 0 && !t.requested[index]) tmp.push({ level: level, x: x, y: y });
                }
            }
            var cx = (box[0] + box[2] - 1) / 2;
            var cy = (box[1] + box[3] - 1) / 2;
            tmp.sort(function (a, b) {
                return Math.abs(a.x - cx) + Math.abs(a.y - cy) - Math.abs(b.x - cx) - Math.abs(b.y - cy);
            });
            t.queued = t.queued.concat(tmp);
        }
        t.preload();
    },
    preload: function () {
        while (this.requestedCount < this.maxRequested && this.queued.length > 0) {
            var tile = this.queued.shift();
            this.loadTile(tile.level, tile.x, tile.y);
        }
    },
    neededBox: function (pos, border, canvas) {
        var t = this;
        if (t.layout == "image") {
            return { level: 0, box: [[0, 0, 1, 1]] };
        }
        var w = this.canvas.width;
        var h = this.canvas.height;
        var minlevel = Math.max(0, Math.min(Math.floor(pos.z + t.mipmapbias), t.nlevels - 1));
        var scale = Math.pow(2, pos.z);
        var box = [];
        for (var level = t.nlevels - 1; level >= minlevel; level--) {
            var bbox = t.getIBox(pos);
            var side = t.tilesize * Math.pow(2, level);
            var qbox = [Math.floor(bbox[0] / side), Math.floor(bbox[1] / side), Math.floor((bbox[2] - 1) / side) + 1, Math.floor((bbox[3] - 1) / side) + 1];
            qbox[0] = Math.max(qbox[0] - border, t.qbox[level][0]);
            qbox[1] = Math.max(qbox[1] - border, t.qbox[level][1]);
            qbox[2] = Math.min(qbox[2] + border, t.qbox[level][2]);
            qbox[3] = Math.min(qbox[3] + border, t.qbox[level][3]);
            box[level] = qbox;
        }
        return { level: minlevel, box: box };
    },
};
Relight.prototype.headFrag = function () {
    var t = this;
    var basetype = t.colorspace == "mrgb" || t.colorspace == "mycc" ? "vec3" : "float";
    var str = `
#ifdef GL_ES
precision highp float;
#endif

const int np1 = ${t.nplanes + 1};
const int nj = ${t.njpegs};
`;
    if (t.colorspace == "mycc")
        str += `
const int ny0 = ${t.yccplanes[0]};
const int ny1 = ${t.yccplanes[1]};
`;
    if (t.normals) {
        if (t.normals == 2) str += "uniform vec3 light;\n";
        str += `
const mat3 T = mat3(8.1650e-01, 4.7140e-01, 4.7140e-01,
	-8.1650e-01, 4.7140e-01,  4.7140e-01,
	-1.6222e-08, -9.4281e-01, 4.7140e-01);
`;
        if (t.colorspace == "lrgb")
            str += `
			uniform ${basetype} base0[np1];
			uniform ${basetype} base1[np1];
			uniform ${basetype} base2[np1];`;
        else
            str += `
			uniform ${basetype} base0[nj];
			uniform ${basetype} base1[nj];
			uniform ${basetype} base2[nj];`;
    }
    str += `
uniform ${basetype} base[np1];
uniform float bias[np1];
uniform float scale[np1];
uniform float opacity;

uniform sampler2D planes[nj];

varying vec2 v_texcoord;
`;
    return str;
};
Relight.prototype.fragTail = function () {
    var str = "";
    switch (this.normals) {
        case 1:
            str = "\tcolor = (normalize(T * color) + 1.0)/2.0;\n";
            break;
        case 2:
            str = `	color = normalize(T * color);
	float c = dot(light, color);
	color = vec3(c, c, c);
`;
            break;
    }
    str += `	gl_FragColor = vec4(color, opacity);
}`;
    return str;
};
Relight.prototype.mrgbFrag = function () {
    let t = this;
    let src = t.headFrag();
    if (!t.normals) {
        src += `void main(void) {
	vec3 color = base[0];
	vec4 c;
`;
        for (let j = 0; j < t.njpegs; j++) {
            src += `	c = texture2D(planes[${j}], v_texcoord);
	color += base[${j}*3+1]*(c.x - bias[${j}*3+1])*scale[${j}*3+1];
	color += base[${j}*3+2]*(c.y - bias[${j}*3+2])*scale[${j}*3+2];
	color += base[${j}*3+3]*(c.z - bias[${j}*3+3])*scale[${j}*3+3];
`;
        }
        let old_src = `void main(void) {
	vec3 color = base[0];

	for(int j = 0; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
		color += base[j*3+1]*(c.x - bias[j*3+1])*scale[j*3+1];
		color += base[j*3+2]*(c.y - bias[j*3+2])*scale[j*3+2];
		color += base[j*3+3]*(c.z - bias[j*3+3])*scale[j*3+3];
	}
`;
    } else {
        src += `void main(void) {
	vec3 one = vec3(1.0 ,1.0, 1.0);
	float b = dot(base[0], one);
	vec3 color = vec3(b);

	for(int j = 0; j < 1; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);

		vec3 b0 = vec3(dot(base0[j*3+1],one), dot(base0[j*3+2],one), dot(base0[j*3+3],one));
		vec3 b1 = vec3(dot(base1[j*3+1],one), dot(base1[j*3+2],one), dot(base1[j*3+3],one));
		vec3 b2 = vec3(dot(base2[j*3+1],one), dot(base2[j*3+2],one), dot(base2[j*3+3],one));

		vec3 r = vec3(
			(c.x - bias[j*3+1])*scale[j*3+1],
			(c.y - bias[j*3+2])*scale[j*3+2],
			(c.z - bias[j*3+3])*scale[j*3+3]);

		color.x += dot(b0, r);
		color.y += dot(b1, r);
		color.z += dot(b2, r);
	}
`;
    }
    src += t.fragTail();
    return src;
};
Relight.prototype.myccFrag = function () {
    var t = this;
    var src = t.headFrag();
    src += `
vec3 toRgb(vec3 ycc) {
 	vec3 rgb;
	rgb.g = ycc.r + ycc.b/2.0;
	rgb.b = ycc.r - ycc.b/2.0 - ycc.g/2.0;
	rgb.r = rgb.b + ycc.g;
	return rgb;
}
`;
    if (!t.normals) {
        src += `
void main(void) { 
	vec3 color = base[0];

	for(int j = 0; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);

		vec3 r = vec3(
			(c.x - bias[j*3+1])*scale[j*3+1],
			(c.y - bias[j*3+2])*scale[j*3+2],
			(c.z - bias[j*3+3])*scale[j*3+3]);

		if(j < ny1) {
			color.x += base[j*3+1].x*r.x;
			color.y += base[j*3+2].y*r.y;
			color.z += base[j*3+3].z*r.z;
		} else {
			color.x += base[j*3+1].x*r.x;
			color.x += base[j*3+2].x*r.y;
			color.x += base[j*3+3].x*r.z;
		}
	}
	color = toRgb(color);
`;
    } else {
        src += `

void main(void) { 
	vec3 color0 = base0[0];
	vec3 color1 = base1[0];
	vec3 color2 = base2[0];

	for(int j = 0; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
		vec3 r = vec3(
			(c.x - bias[j*3+1])*scale[j*3+1],
			(c.y - bias[j*3+2])*scale[j*3+2],
			(c.z - bias[j*3+3])*scale[j*3+3]);

		if(j < ny1) {
			color0.x += base0[j*3+1].x*r.x;
			color0.y += base0[j*3+2].y*r.y;
			color0.z += base0[j*3+3].z*r.z;

			color1.x += base1[j*3+1].x*r.x;
			color1.y += base1[j*3+2].y*r.y;
			color1.z += base1[j*3+3].z*r.z;

			color2.x += base2[j*3+1].x*r.x;
			color2.y += base2[j*3+2].y*r.y;
			color2.z += base2[j*3+3].z*r.z;

		} else {
			color0.x += base0[j*3+1].x*r.x;
			color0.x += base0[j*3+2].x*r.y;
			color0.x += base0[j*3+3].x*r.z;

			color1.x += base1[j*3+1].x*r.x;
			color1.x += base1[j*3+2].x*r.y;
			color1.x += base1[j*3+3].x*r.z;

			color2.x += base2[j*3+1].x*r.x;
			color2.x += base2[j*3+2].x*r.y;
			color2.x += base2[j*3+3].x*r.z;
		}
	}

	color0 = toRgb(color0);
	color1 = toRgb(color1);
	color2 = toRgb(color2);

	vec3 color = vec3(color0.x + color0.y + color0.z, color1.x + color1.y + color1.z, color2.x + color2.y + color2.z);
`;
    }
    src += t.fragTail();
    return src;
};
Relight.prototype.rgbFrag = function () {
    var t = this;
    var src =
        t.headFrag() +
        `
void main(void) {
	vec3 color = vec3(0);
	for(int j = 0; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
`;
    if (!t.normals)
        src += `		color.x += base[j]*(c.x - bias[j*3+1])*scale[j*3+1];
		color.y += base[j]*(c.y - bias[j*3+2])*scale[j*3+2];
		color.z += base[j]*(c.z - bias[j*3+3])*scale[j*3+3];
	}
`;
    else
        src += `		float r = 
			(c.x - bias[j*3+1])*scale[j*3+1] + 
			(c.y - bias[j*3+2])*scale[j*3+2] +
			(c.z - bias[j*3+3])*scale[j*3+3];

		color.x += base0[j]*r;
		color.y += base1[j]*r;
		color.z += base2[j]*r;
	}
`;
    src += t.fragTail();
    return src;
};
Relight.prototype.yccFrag = function () {
    var t = this;
    var src =
        t.headFrag() +
        `
vec3 toYcc(vec4 rgb) {
	vec3 c;
	c.x =       0.299   * rgb.x + 0.587   * rgb.y + 0.114   * rgb.z;
	c.y = 0.5 - 0.16874 * rgb.x - 0.33126 * rgb.y + 0.50000 * rgb.z;
	c.z = 0.5 + 0.50000 * rgb.x - 0.41869 * rgb.y - 0.08131 * rgb.z;
	return c;
}

vec3 toRgb(vec4 ycc) {
	ycc.y -= 0.5;
	ycc.z -= 0.5;
	vec3 c;
	c.x = ycc.x +                   1.402   *ycc.z;
	c.y = ycc.x + -0.344136*ycc.y - 0.714136*ycc.z;
	c.z = ycc.x +  1.772   *ycc.y;
	return c;
}

void main(void) {
	vec3 color = vec3(0);
	for(int j = 0; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
		color.x += base[j]*(c.x - bias[j*3+1])*scale[j*3+1];

		if(j == 0) {
			color.y = (c.y - bias[j*3+2])*scale[j*3+2];
			color.z = (c.z - bias[j*3+3])*scale[j*3+3];
		}
	}

	color = toRgb(vec4(color, 1.0));
`;
    src += t.fragTail();
};
Relight.prototype.lrgbFrag = function () {
    var t = this;
    var src = t.headFrag();
    if (!t.normals)
        src += `
void main(void) {
	vec4 rgb = texture2D(planes[0], v_texcoord);
	float l = 0.0;
	for(int j = 1; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
		l += base[j*3-3]*(c.x - bias[j*3+1])*scale[j*3+1];
		l += base[j*3-2]*(c.y - bias[j*3+2])*scale[j*3+2];
		l += base[j*3-1]*(c.z - bias[j*3+3])*scale[j*3+3];
	}

	vec3 color = vec3(rgb.x*l, rgb.y*l, rgb.z*l);
`;
    else
        src += `
void main(void) {
	vec3 color = vec3(0.0, 0.0, 0.0);

	for(int j = 1; j < nj; j++) {
		vec4 c = texture2D(planes[j], v_texcoord);
		vec3 r = vec3(
			(c.x - bias[j*3+1])*scale[j*3+1],
			(c.y - bias[j*3+2])*scale[j*3+2],
			(c.z - bias[j*3+3])*scale[j*3+3]);

		color.x += base0[j*3-3]*r.x + base0[j*3-2]*r.y + base0[j*3-1]*r.z;
		color.y += base1[j*3-3]*r.x + base1[j*3-2]*r.y + base1[j*3-1]*r.z;
		color.z += base2[j*3-3]*r.x + base2[j*3-2]*r.y + base2[j*3-1]*r.z;
	}
`;
    src += t.fragTail();
    return src;
};
Relight.prototype.imgFrag = function () {
    var src = `#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D planes[1];      //0 is segments
uniform float opacity;

varying vec2 v_texcoord;

void main(void) {
	vec4 c = texture2D(planes[0], v_texcoord);
	gl_FragColor = vec4(c.rgb, opacity);
}`;
    return src;
};
Relight.prototype.demFrag = function () {
    var src = `#ifdef GL_ES
precision highp float;
#endif

uniform vec3 light;
uniform sampler2D planes[1];      //0 is segments
uniform float opacity;
//uniform float azimuth;

varying vec2 v_texcoord;

void main(void) {
	vec4 a = texture2D(planes[0], v_texcoord + vec2(-0.001, -0.001));
	vec4 b = texture2D(planes[0], v_texcoord + vec2( 0.000, -0.001));
	vec4 c = texture2D(planes[0], v_texcoord + vec2(+0.001, -0.001));
	vec4 d = texture2D(planes[0], v_texcoord + vec2(-0.001,  0.000));
	vec4 e = texture2D(planes[0], v_texcoord + vec2( 0.000,  0.000));
	vec4 f = texture2D(planes[0], v_texcoord + vec2(+0.001,  0.000));
	vec4 g = texture2D(planes[0], v_texcoord + vec2(-0.001, +0.001));
	vec4 h = texture2D(planes[0], v_texcoord + vec2( 0.000, +0.001));
	vec4 i = texture2D(planes[0], v_texcoord + vec2(+0.001, +0.001));

	a.r += a.g/256.0;
	b.r += b.g/256.0;
	c.r += c.g/256.0;
	d.r += d.g/256.0;
	e.r += e.g/256.0;
	f.r += f.g/256.0;
	g.r += g.g/256.0;
	h.r += h.g/256.0;
	i.r += i.g/256.0;

	float cellsize = 0.05;

	float dx = -((c.r + (2.0*f.r) + i.r) - (a.r + (2.0*d.r) + g.r)) / (8.0 * cellsize);
	float dy = ((g.r + (2.0*h.r) + i.r) - (a.r + (2.0*b.r) + c.r)) / (8.0 * cellsize);

	vec3 normal = vec3(-dx, -dy, 1.0);
	normal /= sqrt(1.0 + dx*dx + dy*dy);

	float hillshade = dot(normal, light);
	gl_FragColor = vec4(hillshade, hillshade, hillshade, opacity);
	gl_FragColor = vec4(hillshade, hillshade, hillshade, opacity);
}`;
    return src;
};
Relight.prototype.setupShaders = function () {
    var t = this;
    t.vertCode = `uniform mat4 u_matrix;
attribute vec4 a_position;
attribute vec2 a_texcoord;

varying vec2 v_texcoord;

void main() {
	gl_Position = a_position; 
	v_texcoord = a_texcoord;
}`;
    var frag;
    switch (t.type) {
        case "img":
            frag = t.imgFrag();
            break;
        case "dem":
            frag = t.demFrag();
            break;
        default:
            switch (t.colorspace) {
                case "mrgb":
                    frag = t.mrgbFrag();
                    break;
                case "mycc":
                    frag = t.myccFrag();
                    break;
                case "ycc":
                    frag = t.yccFrag();
                    break;
                case "rgb":
                    frag = t.rgbFrag();
                    break;
                case "lrgb":
                    frag = t.lrgbFrag();
                    break;
            }
    }
    t.fragCode = frag;
};
RelightCanvas = function (item, options) {
    var t = this;
    t.options = Object.assign({ pos: { x: 0, y: 0, z: 0, a: 0, t: 0 }, background: [0, 0, 0, 0], bounded: true, zbounded: true, maxzoom: -1, minzoom: 100, border: 1, maxRequested: 4, fit: true, preserveDrawingBuffer: false }, options);
    for (var i in t.options) t[i] = t.options[i];
    if (!item) return null;
    if (typeof item == "string") item = document.querySelector(item);
    if (item.tagName != "CANVAS") return null;
    t.canvas = item;
    var glopt = { antialias: false, depth: false, preserveDrawingBuffer: t.options.preserveDrawingBuffer };
    t.gl = options.gl || t.canvas.getContext("webgl2", glopt) || t.canvas.getContext("webgl", glopt) || t.canvas.getContext("experimental-webgl", glopt);
    if (!t.gl) return null;
    if (t.options.rotation) t.pos.a = t.options.rotation;
    t.previous = { x: 0, y: 0, z: 0, a: 0, t: 0 };
    if (t.options.layers) {
        t.layers = t.options.layers.map((layer) => {
            return new Relight(t.gl, layer);
        });
    } else {
        t.layers = [new Relight(t.gl, t.options)];
    }
    t.layers.forEach((layer) => {
        layer.canvas = t.canvas;
        layer.onLoad(() => {
            t.ready();
        });
        layer.redraw = function () {
            t.redraw();
        };
    });
    t.initGL();
    t._onready = [];
    t._onposchange = [];
    t._onlightchange = [];
};
RelightCanvas.prototype = {
    initGL: function () {
        var gl = this.gl;
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        var b = this.options.background;
        gl.clearColor(b[0], b[1], b[2], b[3], b[4]);
        gl.disable(gl.DEPTH_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    },
    redraw: function () {
        var t = this;
        if (t.animaterequest) return;
        t.animaterequest = requestAnimationFrame(function (time) {
            t.draw(time);
        });
    },
    rot: function (dx, dy, a) {
        var a = Math.PI * (a / 180);
        var x = Math.cos(a) * dx + Math.sin(a) * dy;
        var y = -Math.sin(a) * dx + Math.cos(a) * dy;
        return [x, y];
    },
    project: function (layer, pos) {
        var lz = Math.pow(2, layer.scale);
        var z = Math.pow(2, pos.z);
        var p = this.rot(layer.position[0], layer.position[1], -pos.a);
        var lpos = { x: pos.x * lz - p[0], y: pos.y * lz - p[1], z: pos.z + layer.scale, a: pos.a + layer.rotation };
        return lpos;
    },
    boundingBox: function () {
        var t = this;
        var box = [1e20, 1e20, -1e20, -1e20];
        t.layers.forEach((layer) => {
            var pos = t.project(layer, t.pos);
            var b = layer.getBox(pos);
            box[0] = Math.min(b[0], box[0]);
            box[1] = Math.min(b[1], box[1]);
            box[2] = Math.max(b[2], box[2]);
            box[3] = Math.max(b[3], box[3]);
        });
        return box;
    },
    draw: function (timestamp) {
        var t = this;
        var gl = t.gl;
        t.animaterequest = null;
        t.gl.viewport(0, 0, t.canvas.width, t.canvas.height);
        var b = this.options.background;
        gl.clearColor(b[0], b[1], b[2], b[3], b[4]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        var pos = t.getCurrent(performance.now());
        t.layers.forEach((layer) => {
            var lpos = t.project(layer, pos);
            layer.draw(lpos);
        });
        if (timestamp < t.pos.t) t.redraw();
    },
    prefetch: function () {
        this.layers.forEach((layer) => {
            layer.prefetch();
        });
    },
    ready: function () {
        var t = this;
        for (var i = 0; i < t.layers.length; i++) if (t.layers[i].waiting) return;
        var z = t.pos.z;
        t.pos.z = 0;
        var box = t.boundingBox();
        t.pos.z = z;
        t.width = box[2] - box[0];
        t.height = box[3] - box[1];
        if (t.fit) t.centerAndScale();
        else
            t.layers.forEach((layer) => {
                layer.pos = t.project(layer, t.pos);
            });
        for (var i = 0; i < t._onready.length; i++) t._onready[i]();
        t.layers.forEach((layer) => {
            layer.prefetch();
        });
        t.redraw();
    },
    onReady: function (f) {
        this._onready.push(f);
    },
    onPosChange: function (f) {
        this._onposchange.push(f);
    },
    onLightChange: function (f) {
        this._onlightchange.push(f);
    },
    resize: function (width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.layers.forEach((layer) => {
            layer.prefetch();
        });
        this.redraw();
    },
    zoom: function (dz, dt) {
        var p = this.pos;
        this.setPosition(dt, p.x, p.y, p.z + dz, p.a);
    },
    center: function (dt) {
        var p = this.pos;
        this.setPosition(dt, this.width / 2, this.height / 2, p.z, p.a);
    },
    centerAndScale: function (dt) {
        var t = this;
        var box = t.boundingBox();
        var zoom = Math.pow(2, t.pos.z);
        var scale = Math.max((zoom * (box[2] - box[0])) / t.canvas.width, (zoom * (box[3] - box[1])) / t.canvas.height);
        var z = Math.log(scale) / Math.LN2;
        t.setPosition(dt, (box[2] + box[0]) / 2, (box[3] + box[1]) / 2, z, t.pos.a);
    },
    pan: function (dt, dx, dy) {
        var p = this.pos;
        this.setPosition(dt, p.x - dx, p.y - dy, p.z, p.a);
    },
    rotate: function (dt, angle) {
        var p = this.pos;
        var a = p.a + angle;
        while (a > 360) a -= 360;
        while (a < 0) a += 360;
        this.setPosition(dt, p.x, p.y, p.z, a);
    },
    setPosition: function (dt, x, y, z, a) {
        var t = this;
        if (t.zbounded && t.width) {
            var zx = Math.log(t.width / t.canvas.width) / Math.log(2);
            var zy = Math.log(t.height / t.canvas.height) / Math.log(2);
            var maxz = Math.max(zx, zy);
            if (z > maxz) z = maxz;
            if (z <= t.maxzoom) z = t.maxzoom;
            if (z >= t.minzoom) z = t.minzoom;
        }
        if (t.bounded && t.width) {
            var scale = Math.pow(2, z);
            var boundx = Math.abs((t.width - scale * t.canvas.width) / 2);
            x = Math.max(-boundx, Math.min(boundx, x));
            var boundy = Math.abs((t.height - scale * t.canvas.height) / 2);
            y = Math.max(-boundy, Math.min(boundy, y));
        }
        if (!dt) dt = 0;
        var time = performance.now();
        t.previous = t.getCurrent(time);
        if (x == t.previous.x && y == t.previous.y && z == t.previous.z && a == t.previous.a) return;
        t.pos = { x: x, y: y, z: z, a: a, t: time + dt };
        t.layers.forEach((layer) => {
            layer.pos = t.project(layer, t.pos);
            if (a != t.previous.a) layer.computeLightWeights(layer.light);
        });
        t.prefetch();
        t.redraw();
        for (var i = 0; i < t._onposchange.length; i++) t._onposchange[i]();
    },
    setLight: function (x, y, z) {
        this.layers.forEach((layer) => {
            layer.setLight(x, y, z);
        });
        this._onlightchange.forEach((f) => {
            f();
        });
    },
    setNormals: function (on) {
        this.layers.forEach((layer) => {
            layer.setNormals(on);
        });
        this.redraw();
    },
    getCurrent: function (time) {
        var t = this;
        if (!t.pos.t || time > t.pos.t) return { x: t.pos.x, y: t.pos.y, z: t.pos.z, a: t.pos.a, t: time };
        var dt = t.pos.t - t.previous.t;
        if (dt < 1) return t.pos;
        var dt = (t.pos.t - time) / (t.pos.t - t.previous.t);
        var ft = 1 - dt;
        var z = t.pos.z * ft + t.previous.z * dt;
        var x = t.pos.x * ft + t.previous.x * dt;
        var y = t.pos.y * ft + t.previous.y * dt;
        return { x: x, y: y, z: z, a: t.pos.a * ft + t.previous.a * dt, t: time };
    },
};
function formatMm(val) {
    if (val < 20) return val.toFixed(1) + " mm";
    if (val < 500) return (val / 10).toFixed(1) + " cm";
    if (val < 1e5) return (val / 1e3).toFixed(1) + " m";
    else return (val / 1e6).toFixed(2) + " km";
}
function RelightViewer(div, options) {
    var t = this;
    if (typeof div == "string") div = document.querySelector(div);
    t.div = div;
    t.nav = {
        action: null,
        lighting: true,
        fullscreen: false,
        pandelay: 50,
        zoomdelay: 200,
        zoomstep: 0.25,
        lightsize: 0.8,
        pointers: {},
        support: support,
        pagemap: false,
        normals: 0,
        actions: {
            home: {
                title: "Home",
                task: function (event) {
                    t.centerAndScale(t.nav.zoomdelay);
                },
            },
            zoomin: {
                title: "Zoom In",
                task: function (event) {
                    t.zoom(-t.nav.zoomstep, t.nav.zoomdelay);
                },
            },
            zoomout: {
                title: "Zoom Out",
                task: function (event) {
                    t.zoom(+t.nav.zoomstep, t.nav.zoomdelay);
                },
            },
            rotate: {
                title: "Rotate",
                task: function (event) {
                    t.rotate(t.nav.zoomstep, 45);
                },
            },
            light: {
                title: "Light",
                task: function (event) {
                    t.toggleLight(event);
                },
            },
            normals: {
                title: "Normals",
                task: function (event) {
                    t.toggleNormals(event);
                },
            },
            full: {
                title: "Fullscreen",
                task: function (event) {
                    t.toggleFullscreen(event);
                },
            },
            info: {
                title: "info",
                task: function (event) {
                    t.showInfo();
                },
            },
        },
        scale: 0,
    };
    if (options.hasOwnProperty("notool")) for (var i = 0; i < options.notool.length; i++) delete t.nav.actions[options.notool[i]];
    for (var i in t.nav) if (options.hasOwnProperty(i)) t.nav[i] = options[i];
    var info = document.querySelector(".relight-info-content");
    if (info) info.remove();
    else delete t.nav.actions["info"];
    var html = "\t<canvas></canvas>\n" + '\t<div class="relight-toolbox">\n';
    for (var i in t.nav.actions) {
        var action = t.nav.actions[i];
        if (i == "light" && t.nav.lighting) i += " relight-light_on";
        if (i == "normal" && t.nav.normals) i += " relight-normals_on";
        html += '\t\t<div class="relight-' + i + '" title="' + action.title + '"></div>\n';
    }
    html += "\t</div>\n";
    if (t.nav.scale) html += '\t<div class="relight-scale"><hr/><span></span></div>\n';
    if (t.nav.pagemap) {
        html += "\t<div";
        if (t.nav.pagemap.thumb) html += ' style="background-image:url(' + options.url + "/" + t.nav.pagemap.thumb + '); background-size:cover"';
        html += ' class="relight-pagemap"><div class="relight-pagemap-area"></div></div>\n';
    }
    html += '\t<div class="relight-info-dialog"></div>\n';
    div.innerHTML = html;
    t.dialog = div.querySelector(".relight-info-dialog");
    if (info) {
        t.dialog.appendChild(info);
        info.style.display = "block";
        t.addAction(div, ".relight-info-dialog", function () {
            t.hideInfo();
        });
    }
    if (t.nav.pagemap) {
        t.nav.pagemap.div = div.querySelector(".relight-pagemap");
        t.nav.pagemap.area = div.querySelector(".relight-pagemap-area");
    }
    for (var i in t.nav.actions) t.addAction(div, ".relight-" + i, t.nav.actions[i].task);
    var canvas = div.querySelector("canvas");
    RelightCanvas.call(this, canvas, options);
    var support = "onwheel" in document.createElement("div") ? "wheel" : document.onmousewheel !== undefined ? "mousewheel" : "DOMMouseScroll";
    t.canvas.addEventListener(
        support,
        function (e) {
            t.mousewheel(e);
        },
        false
    );
    window.addEventListener("resize", function (e) {
        t.resize(canvas.offsetWidth, canvas.offsetHeight);
        if (options.scale) t.updateScale();
        t.updatePagemap();
    });
    t.canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        return false;
    });
    var mc = new Hammer.Manager(t.canvas);
    mc.add(new Hammer.Pan({ pointers: 1, direction: Hammer.DIRECTION_ALL, threshold: 0 }));
    mc.on("panstart", function (ev) {
        t.mousedown(ev);
    });
    mc.on("panmove", function (ev) {
        t.mousemove(ev);
    });
    mc.on("panend pancancel", function (ev) {
        t.mouseup(ev);
    });
    mc.add(new Hammer.Pinch());
    mc.on("pinchstart", function (ev) {
        t.mousedown(ev);
    });
    mc.on("pinchmove", function (ev) {
        t.mousemove(ev);
    });
    mc.on("pinchend pinchcancel", function (ev) {
        t.mouseup(ev);
    });
    mc.add(new Hammer.Tap({ taps: 2 }));
    mc.on("tap", function (ev) {
        t.zoom(-2 * t.nav.zoomstep, t.nav.zoomdelay);
    });
    t.resize(canvas.offsetWidth, canvas.offsetHeight);
    if (options.scale)
        t.onPosChange(function () {
            t.updateScale();
        });
    if (t.nav.pagemap) {
        t.onReady(function () {
            t.initPagemap();
        });
        t.onPosChange(function () {
            t.updatePagemap();
        });
    }
}
RelightViewer.prototype = RelightCanvas.prototype;
RelightViewer.prototype.addAction = function (div, selector, action) {
    var tap = new Hammer.Manager(div.querySelector(selector));
    tap.add(new Hammer.Tap());
    tap.on("tap", action);
};
RelightViewer.prototype.toggleLight = function (event) {
    var t = this;
    if (t.nav.lighting) event.target.classList.remove("relight-light_on");
    else event.target.classList.add("relight-light_on");
    t.nav.lighting = !t.nav.lighting;
};
RelightViewer.prototype.toggleNormals = function (event) {
    var t = this;
    t.nav.normals = (t.nav.normals + 1) % 3;
    t.setNormals(t.nav.normals);
    if (!t.nav.normals) event.target.classList.remove("relight-normals_on");
    else event.target.classList.add("relight-normals_on");
};
RelightViewer.prototype.toggleFullscreen = function (event) {
    var t = this;
    var div = t.div;
    if (t.nav.fullscreen) {
        var request = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        request.call(document);
        event.target.classList.remove("relight-full_on");
        div.style.height = "100%";
        t.resize(t.canvas.offsetWidth, t.canvas.offsetHeight);
    } else {
        var request = div.requestFullscreen || div.webkitRequestFullscreen || div.mozRequestFullScreen || div.msRequestFullscreen;
        request.call(div);
        event.target.classList.add("relight-full_on");
    }
    div.style.height = window.offsetHeight + "px";
    t.resize(t.canvas.offsetWidth, t.canvas.offsetHeight);
    t.nav.fullscreen = !t.nav.fullscreen;
};
RelightViewer.prototype.updateScale = function () {
    var t = this;
    var span = t.div.querySelector(".relight-scale > span");
    var hr = t.div.querySelector(".relight-scale > hr");
    var scale = Math.pow(2, t.pos.z);
    var scalesize = t.options.scale * hr.offsetWidth * scale;
    span.innerHTML = formatMm(scalesize);
    var box = t.div.querySelector(".relight-scale");
    box.style.opacity = 1;
    if (t.nav.scaletimeout) clearTimeout(t.nav.scaletimeout);
    t.nav.scaletimeout = setTimeout(function () {
        t.nav.scaletimeout = null;
        box.style.opacity = 0.1;
    }, 1e3);
};
RelightViewer.prototype.initPagemap = function () {
    var t = this;
    var page = t.nav.pagemap;
    var size = page.size || page.div.offsetWidth;
    var w = t.width;
    var h = t.height;
    if (w > h) {
        page.w = size;
        page.h = (size * h) / w;
    } else {
        page.w = (size * w) / h;
        page.h = size;
    }
    page.div.style.width = page.w + "px";
    page.div.style.height = page.h + "px";
    page.area.style.width = page.w / 2 + "px";
    page.area.style.height = page.h / 2 + "px";
    t.updatePagemap();
};
RelightViewer.prototype.updatePagemap = function () {
    var t = this;
    var page = t.nav.pagemap;
    var a = page.area;
    if (!page.w) return;
    var w = t.canvas.width;
    var h = t.canvas.height;
    var box = t.boundingBox();
    var offset = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    var scale = Math.pow(2, t.pos.z);
    var center = [-offset[0] / scale / t.canvas.width + 0.5, -offset[1] / scale / t.canvas.height + 0.5];
    var width = (t.canvas.width * scale) / t.width;
    var height = (t.canvas.height * scale) / t.height;
    var bbox = [
        Math.max(0, parseInt(page.w * (center[0] - width / 2))),
        Math.max(0, parseInt(page.h * (center[1] - height / 2))),
        Math.min(page.w, parseInt(page.w * (center[0] + width / 2))),
        Math.min(page.h, parseInt(page.h * (center[1] + height / 2))),
    ];
    page.area.style.left = bbox[0] + "px";
    page.area.style.top = bbox[1] + "px";
    page.area.style.width = bbox[2] - bbox[0] + "px";
    page.area.style.height = bbox[3] - bbox[1] + "px";
    page.div.style.opacity = 1;
    if (page.autohide) {
        if (page.timeout) clearTimeout(page.timeout);
        page.timeout = setTimeout(function () {
            page.timeout = null;
            page.div.style.opacity = 0.1;
        }, page.autohide);
    }
};
RelightViewer.prototype.mousedown = function (event) {
    var t = this;
    var src = event.srcEvent;
    if (event.type == "pinchstart") {
        t.nav.action = "zoom";
    } else if (!t.nav.lighting || src.shiftKey || src.ctrlKey || src.buttons & 2) {
        t.nav.action = "pan";
    } else {
        t.nav.action = "light";
        t.lightDirection(event);
    }
    t.nav.pos = this.pos;
    t.nav.light = this.light;
};
RelightViewer.prototype.lightDirection = function (event) {
    var t = this;
    var e = event.srcEvent;
    var w = (t.nav.lightsize * t.canvas.width) / 2;
    var h = (t.nav.lightsize * t.canvas.height) / 2;
    var x = (e.offsetX - t.canvas.width / 2) / w;
    var y = (e.offsetY - t.canvas.height / 2) / h;
    var r = Math.sqrt(x * x + y * y);
    if (r > 1) {
        x /= r;
        y /= r;
        r = 1;
    }
    var z = Math.sqrt(1 - r);
    t.setLight(x, -y, z);
};
RelightViewer.prototype.mousemove = function (event) {
    var t = this;
    if (!t.nav.action) return;
    var p = t.nav.pos;
    var x = event.deltaX;
    var y = event.deltaY;
    var scale = Math.pow(2, p.z);
    switch (t.nav.action) {
        case "pan":
            t.setPosition(t.nav.pandelay, p.x - x * scale, p.y - y * scale, p.z, p.a);
            break;
        case "zoom":
            z = p.z - Math.log(event.scale) / Math.log(2);
            t.setPosition(t.nav.zoomdelay, p.x, p.y, z, p.a);
            break;
        case "light":
            t.lightDirection(event);
            break;
    }
};
RelightViewer.prototype.mouseup = function (event) {
    if (this.nav.action) {
        this.nav.action = null;
        event.preventDefault();
    }
};
RelightViewer.prototype.mousewheel = function (event) {
    if (this.nav.support == "mousewheel") {
        event.deltaY = (-1 / 40) * event.wheelDelta;
    } else {
        event.deltaY = event.deltaY || event.detail;
    }
    var dz = event.deltaY > 0 ? this.nav.zoomstep : -this.nav.zoomstep;
    this.zoom(-dz, this.nav.zoomdelay);
    event.preventDefault();
};
RelightViewer.prototype.setInfo = function (info) {
    if (typeof info == "string") this.dialog.innerHTML = info;
    else this.dialog.append(info);
};
RelightViewer.prototype.showInfo = function () {
    this.dialog.style.display = "block";
};
RelightViewer.prototype.hideInfo = function () {
    this.dialog.style.display = "none";
};
