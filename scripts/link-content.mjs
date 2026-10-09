// The engine and its RuneScript compiler look for content at ../content
// (Engine-TS/src/util/WorldConfig.ts build.srcDir default, and the compiler's
// own '../content/scripts' default, which ignores build.srcDir). The submodule
// is named Content. On case-insensitive filesystems (Windows, default macOS)
// 'content' already resolves to 'Content'; on Linux we add a symlink.
import fs from 'fs';

if (fs.existsSync('content')) {
    console.log('content/ resolves already, nothing to do');
} else {
    fs.symlinkSync('Content', 'content', 'junction');
    console.log('linked content -> Content');
}
