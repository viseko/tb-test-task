// Обрезка текста
// https://stackoverflow.com/questions/49304123/truncate-string-containing-html-tags-in-javascript

export default function truncate(str: string, n: number) {
  var openTags = [];
  var inTag = false;
  var tagName = "";
  var tagNameComplete = false;
  var tagClosing = false;
  var lastSpace = 0;

  for (let p = 0; p < str.length && p < n; p++) {
    let c = str.charAt(p);
    switch (c) {
      case "<":
        lastSpace = !inTag && p + 3 < n ? p : lastSpace;
        inTag = true;
        tagName = "";
        tagNameComplete = false;
        break;
      case ">":
        if (inTag && !tagNameComplete) {
          openTags.push({
            tag: tagName,
            p: p,
          });
          tagNameComplete = true;
        }
        inTag = false;
        if (tagClosing) openTags.pop();
        tagClosing = false;
        tagName = ""; //may be redundant
        break;
      case "/":
        tagClosing = inTag;
        break;
      case " ":
        lastSpace = !inTag && p + 3 < n ? p : lastSpace;
        if (inTag && !tagNameComplete) {
          openTags.push({
            tag: tagName,
            p: p,
          });
          tagNameComplete = true;
        }
        break;
    }
    if (!tagNameComplete && c !== "<" && c !== ">") tagName += c;
  }

  let small = str.substring(0, lastSpace) + "...";
  for (var i = openTags.length - 1; i >= 0; i--)
    if (openTags[i].p <= lastSpace) small += "</" + openTags[i].tag + ">";

  return small;
}
