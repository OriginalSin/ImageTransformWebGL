var gmxImageTransform = function(img, hash) {
    var ready = false,
        gmx = hash.gmx,
        gmxTilePoint = hash.gmxTilePoint,
        mInPixel = gmx.mInPixel,
        geoItem = hash.geoItem,
        properties = geoItem.properties,
        dataOption = geoItem.dataOption || {},
        geom = properties[properties.length - 1],
        coord = geom.coordinates[0],
        begx = mInPixel * dataOption.bounds.min.x,
        begy = mInPixel * dataOption.bounds.max.y,
        indexes = gmx.tileAttributeIndexes,
        quicklookPlatform = properties[indexes[gmx.quicklookPlatform]] || gmx.quicklookPlatform || '',
        points = {};

    if (geom.type === 'MULTIPOLYGON') { coord = coord[0]; }
    if (quicklookPlatform === 'LANDSAT8') {
        points.x1 = dataOption.bounds.min.x; points.y1 = dataOption.bounds.max.y;
        points.x2 = dataOption.bounds.max.x; points.y2 = dataOption.bounds.max.y;
        points.x3 = dataOption.bounds.max.x; points.y3 = dataOption.bounds.min.y;
        points.x4 = dataOption.bounds.min.x; points.y4 = dataOption.bounds.min.y;
        ready = true;
    // } else if (quicklookPlatform === 'SPOT 6') {
        // points.x1 = coord[0][0]; points.y1 = coord[0][1];
        // points.x2 = coord[1][0]; points.y2 = coord[1][1];
        // points.x3 = coord[2][0]; points.y3 = coord[2][1];
        // points.x4 = coord[3][0]; points.y4 = coord[3][1];
        // ready = true;
    } else if (quicklookPlatform === 'imageMercator' || quicklookPlatform === 'image') {
        points.x1 = gmx.quicklookX1 ? properties[indexes[gmx.quicklookX1]] : properties[indexes.x1] || 0;
        points.y1 = gmx.quicklookY1 ? properties[indexes[gmx.quicklookY1]] : properties[indexes.y1] || 0;
        points.x2 = gmx.quicklookX2 ? properties[indexes[gmx.quicklookX2]] : properties[indexes.x2] || 0;
        points.y2 = gmx.quicklookY2 ? properties[indexes[gmx.quicklookY2]] : properties[indexes.y2] || 0;
        points.x3 = gmx.quicklookX3 ? properties[indexes[gmx.quicklookX3]] : properties[indexes.x3] || 0;
        points.y3 = gmx.quicklookY3 ? properties[indexes[gmx.quicklookY3]] : properties[indexes.y3] || 0;
        points.x4 = gmx.quicklookX4 ? properties[indexes[gmx.quicklookX4]] : properties[indexes.x4] || 0;
        points.y4 = gmx.quicklookY4 ? properties[indexes[gmx.quicklookY4]] : properties[indexes.y4] || 0;
        if (quicklookPlatform === 'image') {
            var merc = L.Projection.Mercator.project(L.latLng(points.y1, points.x1));
            points.x1 = merc.x; points.y1 = merc.y;
            merc = L.Projection.Mercator.project(L.latLng(points.y2, points.x2));
            points.x2 = merc.x; points.y2 = merc.y;
            merc = L.Projection.Mercator.project(L.latLng(points.y3, points.x3));
            points.x3 = merc.x; points.y3 = merc.y;
            merc = L.Projection.Mercator.project(L.latLng(points.y4, points.x4));
            points.x4 = merc.x; points.y4 = merc.y;
        }
        ready = true;
        begx = mInPixel * points.x1;
        begy = mInPixel * points.y1;
    } else {
        points = gmxAPIutils.getQuicklookPoints(coord);
    }

    var dx = begx - 256 * gmxTilePoint.x,
        dy = 256 - begy + 256 * gmxTilePoint.y,
        x1 = mInPixel * points.x1, y1 = mInPixel * points.y1,
        x2 = mInPixel * points.x2, y2 = mInPixel * points.y2,
        x3 = mInPixel * points.x3, y3 = mInPixel * points.y3,
        x4 = mInPixel * points.x4, y4 = mInPixel * points.y4,
        boundsP = gmxAPIutils.bounds([[x1, y1], [x2, y2], [x3, y3], [x4, y4]]),
        ww = Math.round(boundsP.max.x - boundsP.min.x),
        hh = Math.round(boundsP.max.y - boundsP.min.y);

    x1 -= boundsP.min.x; y1 = boundsP.max.y - y1;
    x2 -= boundsP.min.x; y2 = boundsP.max.y - y2;
    x3 -= boundsP.min.x; y3 = boundsP.max.y - y3;
    x4 -= boundsP.min.x; y4 = boundsP.max.y - y4;

    var shiftPoints = [[x1, y1], [x2, y2], [x3, y3], [x4, y4]];
    if (!ready) {
        var chPoints = function(arr) {
//Алгоритм натяжения:
//- вычислить 4 угла (текущий алгоритм)
//- посчитать длины сторон
//- если соотношение самой длинной и самой короткой больше, чем 2, тогда северный отрезок из двух коротких - это верхний край квиклука
//- если соотношение меньше, чем 2, то самая северная вершина - это левый верхний угол изображения
            var out = [], dist = [],
                px = arr[3][0],
                py = arr[3][1];
            for (var i = 0, len = arr.length; i < len; i++) {
                var px1 = arr[i][0], py1 = arr[i][1],
                    sx = px1 - px, sy = py1 - py;
                dist.push({'d2': Math.sqrt(sx * sx + sy * sy), 'i': i});
                px = px1; py = py1;
            }
            dist = dist.sort(function(a, b) { return a.d2 - b.d2; });
            out = arr;
            if (dist[3].d2 / dist[0].d2 > 2) {
                out = [];
                var si = arr[dist[0].i][1] < arr[dist[1].i][1] ? dist[0].i : dist[1].i;
                out.push(arr[(si + 3) % 4]);
                out.push(arr[(si + 4) % 4]);
                out.push(arr[(si + 5) % 4]);
                out.push(arr[(si + 6) % 4]);
            }
            return out;
        };
        shiftPoints = chPoints(shiftPoints);
    }

    // if (!gmx.ProjectiveImage) { gmx.ProjectiveImage = new ProjectiveImage(); }
    if (!gmx.ProjectiveImage) { gmx.ProjectiveImage = new L.gmx.ProjectiveImageWebGL(img, {anchors: shiftPoints}); }
    var pt = gmx.ProjectiveImage.getCanvas({
        imageObj: img,
        points: shiftPoints,
        wView: ww,
        hView: hh,
        deltaX: dx,
        deltaY: dy
        //,patchSize: 64
        //,limit: 4
    });
    return pt.canvas;
};
