#ifdef __APPLE__

#include "core/clipboard/native_clipboard.h"

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include <atomic>
#include <filesystem>
#include <mutex>
#include <optional>
#include <utility>
#include <vector>

namespace misty::core {
namespace {

std::vector<uint8_t> bytes_from_data(NSData* data) {
    if (!data || [data length] == 0) {
        return {};
    }
    const auto* raw = static_cast<const uint8_t*>([data bytes]);
    return std::vector<uint8_t>(raw, raw + [data length]);
}

NSData* data_from_bytes(const std::vector<uint8_t>& bytes) {
    if (bytes.empty()) {
        return nil;
    }
    return [NSData dataWithBytes:bytes.data() length:bytes.size()];
}

std::string utf8_from_nsstring(NSString* value) {
    if (!value) {
        return {};
    }
    const char* raw = [value UTF8String];
    return raw ? std::string(raw) : std::string{};
}

ClipboardPayloadKind preferred_kind_for(const ClipboardPayload& payload) {
    if (!payload.images.empty()) {
        return ClipboardPayloadKind::Image;
    }
    if (!payload.file_refs.empty()) {
        return ClipboardPayloadKind::FileRefs;
    }
    if (!payload.html.empty()) {
        return ClipboardPayloadKind::Html;
    }
    if (!payload.text.empty()) {
        return ClipboardPayloadKind::Text;
    }
    return ClipboardPayloadKind::Empty;
}

std::vector<ClipboardFileRef> read_file_refs(NSPasteboard* pasteboard) {
    std::vector<ClipboardFileRef> refs;
    NSArray* classes = @[[NSURL class]];
    NSDictionary* options = @{NSPasteboardURLReadingFileURLsOnlyKey: @YES};
    NSArray* urls = [pasteboard readObjectsForClasses:classes options:options];
    for (NSURL* url in urls) {
        if (![url isFileURL]) {
            continue;
        }
        NSString* path = [url path];
        if (!path) {
            continue;
        }
        ClipboardFileRef ref;
        ref.local_path = utf8_from_nsstring(path);
        ref.display_name = utf8_from_nsstring([url lastPathComponent]);
        NSNumber* is_dir = nil;
        if ([url getResourceValue:&is_dir forKey:NSURLIsDirectoryKey error:nil]) {
            ref.is_dir = [is_dir boolValue] == YES;
        } else if (!ref.local_path.empty()) {
            std::error_code ec;
            ref.is_dir = std::filesystem::is_directory(ref.local_path, ec);
        }
        refs.push_back(std::move(ref));
    }
    return refs;
}

std::optional<ClipboardImage> read_image(NSPasteboard* pasteboard) {
    NSData* png = [pasteboard dataForType:NSPasteboardTypePNG];
    if (png) {
        ClipboardImage image;
        image.mime_type = "image/png";
        image.bytes = bytes_from_data(png);
        image.size_bytes = image.bytes.size();
        if (NSImage* ns_image = [[NSImage alloc] initWithData:png]) {
            NSSize size = [ns_image size];
            image.width = static_cast<int>(size.width);
            image.height = static_cast<int>(size.height);
        }
        return image;
    }

    NSData* tiff = [pasteboard dataForType:NSPasteboardTypeTIFF];
    if (!tiff) {
        NSImage* ns_image = [[NSImage alloc] initWithPasteboard:pasteboard];
        tiff = [ns_image TIFFRepresentation];
    }
    if (!tiff) {
        return std::nullopt;
    }
    NSBitmapImageRep* rep = [NSBitmapImageRep imageRepWithData:tiff];
    NSData* converted = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!converted) {
        return std::nullopt;
    }
    ClipboardImage image;
    image.mime_type = "image/png";
    image.bytes = bytes_from_data(converted);
    image.size_bytes = image.bytes.size();
    image.width = static_cast<int>([rep pixelsWide]);
    image.height = static_cast<int>([rep pixelsHigh]);
    return image;
}

class MacNativeClipboard final : public NativeClipboard {
public:
    ~MacNativeClipboard() override { stop(); }

    bool start(ChangeCallback on_change) override {
        std::lock_guard<std::mutex> lock(mu_);
        callback_ = std::move(on_change);
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        last_change_count_ = [pasteboard changeCount];
        running_.store(true);

        timer_ = [NSTimer timerWithTimeInterval:0.25
                                        repeats:YES
                                          block:^(NSTimer*) {
                                              this->check_for_change();
                                          }];
        [[NSRunLoop mainRunLoop] addTimer:timer_ forMode:NSRunLoopCommonModes];
        return true;
    }

    void stop() override {
        running_.store(false);
        std::lock_guard<std::mutex> lock(mu_);
        if (timer_) {
            [timer_ invalidate];
            timer_ = nil;
        }
        callback_ = nullptr;
    }

    std::optional<std::string> read_text() const override {
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        NSString* text = [pasteboard stringForType:NSPasteboardTypeString];
        if (!text) {
            return std::nullopt;
        }
        return utf8_from_nsstring(text);
    }

    bool write_text(const std::string& text) override {
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        [pasteboard clearContents];
        NSString* value = [NSString stringWithUTF8String:text.c_str()];
        const BOOL ok = [pasteboard setString:value forType:NSPasteboardTypeString];
        last_change_count_ = [pasteboard changeCount];
        return ok == YES;
    }

    std::optional<ClipboardPayload> read_payload() const override {
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        ClipboardPayload payload;
        payload.origin = ClipboardOrigin::LocalSystem;

        if (auto image = read_image(pasteboard); image.has_value()) {
            payload.images.push_back(std::move(*image));
        }
        payload.file_refs = read_file_refs(pasteboard);
        if (NSString* html = [pasteboard stringForType:NSPasteboardTypeHTML]) {
            payload.html = utf8_from_nsstring(html);
        }
        if (NSString* text = [pasteboard stringForType:NSPasteboardTypeString]) {
            payload.text = utf8_from_nsstring(text);
        }
        payload.kind = preferred_kind_for(payload);
        if (payload.empty()) {
            return std::nullopt;
        }
        return payload;
    }

    bool write_payload(const ClipboardPayload& payload) override {
        if (payload.empty()) {
            return false;
        }
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        [pasteboard clearContents];

        bool wrote = false;
        NSMutableArray<NSURL*>* urls = [NSMutableArray array];
        for (const auto& ref : payload.file_refs) {
            if (ref.local_path.empty()) {
                continue;
            }
            NSString* path = [NSString stringWithUTF8String:ref.local_path.c_str()];
            NSURL* url = [NSURL fileURLWithPath:path isDirectory:ref.is_dir ? YES : NO];
            if (url) {
                [urls addObject:url];
            }
        }
        if ([urls count] > 0) {
            wrote = [pasteboard writeObjects:urls] == YES || wrote;
        }

        if (!payload.images.empty() && !payload.images.front().bytes.empty()) {
            NSData* png = data_from_bytes(payload.images.front().bytes);
            if (png) {
                wrote = [pasteboard setData:png forType:NSPasteboardTypePNG] == YES || wrote;
                NSBitmapImageRep* rep = [NSBitmapImageRep imageRepWithData:png];
                NSData* tiff = [rep TIFFRepresentation];
                if (tiff) {
                    [pasteboard setData:tiff forType:NSPasteboardTypeTIFF];
                }
            }
        }

        if (!payload.html.empty()) {
            NSString* html = [NSString stringWithUTF8String:payload.html.c_str()];
            wrote = [pasteboard setString:html forType:NSPasteboardTypeHTML] == YES || wrote;
        }
        if (!payload.text.empty()) {
            NSString* text = [NSString stringWithUTF8String:payload.text.c_str()];
            wrote = [pasteboard setString:text forType:NSPasteboardTypeString] == YES || wrote;
        }

        last_change_count_ = [pasteboard changeCount];
        return wrote;
    }

    bool supported() const override { return true; }

private:
    void check_for_change() {
        if (!running_.load()) {
            return;
        }
        ChangeCallback callback;
        NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
        const NSInteger change_count = [pasteboard changeCount];
        {
            std::lock_guard<std::mutex> lock(mu_);
            if (change_count == last_change_count_) {
                return;
            }
            last_change_count_ = change_count;
            callback = callback_;
        }
        if (callback) {
            callback();
        }
    }

    mutable std::mutex mu_;
    ChangeCallback callback_;
    NSTimer* timer_ = nil;
    std::atomic<bool> running_{false};
    NSInteger last_change_count_ = 0;
};

}  // namespace

std::unique_ptr<NativeClipboard> create_native_clipboard_mac() {
    return std::make_unique<MacNativeClipboard>();
}

}  // namespace misty::core

#endif
