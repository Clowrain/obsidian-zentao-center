// US-821 / US-802: AES-256-GCM encryption for Zentao password storage.
// Obsidian plugins store settings as plain JSON in data.json, so passwords
// must never be stored in cleartext. This module derives a 256-bit key from
// a fixed seed + vault path, encrypts with a random IV per operation, and
// stores IV alongside the ciphertext.
//
// Security note: the encryption key is derived from a hardcoded seed visible
// in the open-source plugin code. This prevents casual data.json leaks but
// does NOT provide the same security as a system keychain. Users who need
// stronger protection should consider this a trade-off.

const FIXED_SEED = "obsidian-task-center-zentao-v1";
const ENCRYPTION_ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for GCM

async function deriveKey(vaultPath: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const seedMaterial = encoder.encode(FIXED_SEED + ":" + vaultPath);
	const hashBuffer = await crypto.subtle.digest("SHA-256", seedMaterial);
	return crypto.subtle.importKey(
		"raw",
		hashBuffer,
		{ name: ENCRYPTION_ALGO, length: KEY_LENGTH },
		false,
		["encrypt", "decrypt"],
	);
}

function arrayToBase64(buffer: Uint8Array): string {
	return btoa(String.fromCharCode(...buffer));
}

function base64ToArray(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

/** Encrypt a plaintext string. Returns base64-encoded IV and ciphertext separately. */
export async function encrypt(
	plaintext: string,
	vaultPath: string,
): Promise<{ encrypted: string; iv: string }> {
	if (!plaintext) return { encrypted: "", iv: "" };
	const key = await deriveKey(vaultPath);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoder = new TextEncoder();
	const ciphertext = await crypto.subtle.encrypt(
		{ name: ENCRYPTION_ALGO, iv },
		key,
		encoder.encode(plaintext),
	);
	return {
		encrypted: arrayToBase64(new Uint8Array(ciphertext)),
		iv: arrayToBase64(iv),
	};
}

/** Decrypt a previously encrypted string. */
export async function decrypt(
	encrypted: string,
	iv: string,
	vaultPath: string,
): Promise<string> {
	if (!encrypted || !iv) return "";
	const key = await deriveKey(vaultPath);
	const ciphertext = base64ToArray(encrypted);
	const ivBytes = base64ToArray(iv);
	const plaintext = await crypto.subtle.decrypt(
		{ name: ENCRYPTION_ALGO, iv: toArrayBuffer(ivBytes) },
		key,
		toArrayBuffer(ciphertext),
	);
	return new TextDecoder().decode(plaintext);
}

/** Check if crypto.subtle is available (should always be true in Obsidian). */
export function isCryptoAvailable(): boolean {
	return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}
