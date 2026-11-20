---
"@folijs/core": patch
"@folijs/view": patch
---

Pictures copied into another document bring their images: the copy carries the resources its
pictures use (an image shown from a package part or an object URL as a `data:` URL), and the
paste adds them to the target under keys of their own (the same image already there is reused).
Before, the pictures pasted as empty boxes, or showed the target's image of the same key.
