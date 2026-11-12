import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	stat,
	statfs,
	unlink,
	writeFile,
	readFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 服务端素材转码服务。
 *
 * 素材本体存在浏览器 OPFS 里，服务器看不到，所以前端把解不了的素材流式上传到
 * 这里，转成浏览器能吃的 H.264 8bit 4:2:0，再回传给前端存回 OPFS。
 *
 * 目录布局（默认 /data/media，compse 里挂到 ~/docker/opencut/media）：
 *   tmp/<jobId>.<ext>   上传中的原始文件，转码成功/失败后立即删除
 *   out/<jobId>.mp4     转码产物（保留，供弹窗管理和复用）
 *
 * 只保留转码后的文件 —— 上传者本地有源文件，没必要在服务器再存一份。
 */

export const MEDIA_ROOT = process.env.OPENCUT_MEDIA_ROOT ?? "/data/media";
const TMP_DIR = path.join(MEDIA_ROOT, "tmp");
const OUT_DIR = path.join(MEDIA_ROOT, "out");

export type JobStatus =
	| "uploading"
	| "probing"
	| "running"
	| "done"
	| "error"
	| "cancelled";

export interface TranscodeJob {
	id: string;
	name: string;
	status: JobStatus;
	progress: number;
	speed: string | null;
	fps: number | null;
	outTimeMs: number;
	durationMs: number;
	sourceSize: number;
	outputSize: number;
	outputName: string | null;
	codec: string | null;
	profile: string | null;
	pixFmt: string | null;
	width: number | null;
	height: number | null;
	error: string | null;
	createdAt: number;
	finishedAt: number | null;
}

const jobs = new Map<string, TranscodeJob>();
const processes = new Map<string, ReturnType<typeof spawn>>();

let dirsReady: Promise<void> | null = null;

function ensureDirs(): Promise<void> {
	if (!dirsReady) {
		dirsReady = (async () => {
			await mkdir(TMP_DIR, { recursive: true });
			await mkdir(OUT_DIR, { recursive: true });
		})();
	}
	return dirsReady;
}

function runProbe(input: string): Promise<{
	durationMs: number;
	codec: string | null;
	profile: string | null;
	pixFmt: string | null;
	width: number | null;
	height: number | null;
}> {
	return new Promise((resolve) => {
		const proc = spawn("ffprobe", [
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,profile,pix_fmt,width,height:format=duration",
			"-of",
			"json",
			input,
		]);

		let stdout = "";
		proc.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.on("error", () =>
			resolve({
				durationMs: 0,
				codec: null,
				profile: null,
				pixFmt: null,
				width: null,
				height: null,
			}),
		);
		proc.on("close", () => {
			try {
				const parsed = JSON.parse(stdout || "{}") as {
					streams?: Array<{
						codec_name?: string;
						profile?: string;
						pix_fmt?: string;
						width?: number;
						height?: number;
					}>;
					format?: { duration?: string };
				};
				const stream = parsed.streams?.[0] ?? {};
				const seconds = Number.parseFloat(parsed.format?.duration ?? "0");
				resolve({
					durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
					codec: stream.codec_name ?? null,
					profile: stream.profile ?? null,
					pixFmt: stream.pix_fmt ?? null,
					width: stream.width ?? null,
					height: stream.height ?? null,
				});
			} catch {
				resolve({
					durationMs: 0,
					codec: null,
					profile: null,
					pixFmt: null,
					width: null,
					height: null,
				});
			}
		});
	});
}

export interface TranscodeOptions {
	/** 目标高度，null = 保持原分辨率 */
	height: number | null;
	/** x264 CRF，越小越清晰 */
	crf: number;
}

function buildArgs({
	input,
	output,
	options,
	sourceHeight,
}: {
	input: string;
	output: string;
	options: TranscodeOptions;
	sourceHeight: number | null;
}): string[] {
	const args = [
		"-hide_banner",
		"-nostdin",
		"-y",
		"-i",
		input,
		"-c:v",
		"libx264",
		"-profile:v",
		"high",
		// 这两项是浏览器能不能解码的关键：强制 8bit 4:2:0
		"-pix_fmt",
		"yuv420p",
		"-preset",
		"veryfast",
		"-crf",
		String(options.crf),
	];

	const needsScale =
		options.height !== null &&
		(sourceHeight === null || sourceHeight > options.height);
	if (needsScale) {
		// 只缩小不放大，宽度取偶数（yuv420p 要求）
		args.push("-vf", `scale=-2:${options.height}`);
	}

	args.push(
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		"-progress",
		"pipe:1",
		"-nostats",
		output,
	);

	return args;
}

function startFfmpeg({
	job,
	input,
	output,
	options,
}: {
	job: TranscodeJob;
	input: string;
	output: string;
	options: TranscodeOptions;
}): void {
	const args = buildArgs({
		input,
		output,
		options,
		sourceHeight: job.height,
	});

	const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
	processes.set(job.id, proc);
	job.status = "running";

	let stderrTail: string[] = [];
	let buffer = "";

	proc.stdout?.on("data", (chunk) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const [key, value] = line.split("=");
			if (!key || value === undefined) continue;

			if (key === "out_time_ms") {
				const ms = Number.parseInt(value, 10);
				if (Number.isFinite(ms) && job.durationMs > 0) {
					job.outTimeMs = ms;
					job.progress = Math.min(
						99,
						Math.round((ms / job.durationMs) * 100),
					);
				}
			} else if (key === "speed") {
				job.speed = value.trim();
			} else if (key === "fps") {
				const fps = Number.parseFloat(value);
				if (Number.isFinite(fps)) job.fps = Math.round(fps);
			}
		}
	});

	proc.stderr?.on("data", (chunk) => {
		stderrTail.push(chunk.toString());
		if (stderrTail.length > 40) stderrTail = stderrTail.slice(-40);
	});

	proc.on("error", (error) => {
		job.status = "error";
		job.error = `ffmpeg 启动失败: ${error.message}`;
		job.finishedAt = Date.now();
		processes.delete(job.id);
		void cleanupInput(input);
	});

	proc.on("close", async (code) => {
		processes.delete(job.id);
		await cleanupInput(input);

		if (job.status === "cancelled") {
			await unlink(output).catch(() => undefined);
			return;
		}

		if (code !== 0) {
			job.status = "error";
			job.error =
				stderrTail
					.join("")
					.split("\n")
					.filter((line) => line.trim().length > 0)
					.slice(-6)
					.join(" | ") || `ffmpeg 退出码 ${code}`;
			job.finishedAt = Date.now();
			await unlink(output).catch(() => undefined);
			return;
		}

		try {
			const info = await stat(output);
			job.outputSize = info.size;
		} catch {
			job.outputSize = 0;
		}

		job.status = "done";
		job.progress = 100;
		job.outTimeMs = job.durationMs;
		job.finishedAt = Date.now();
	});
}

async function cleanupInput(input: string): Promise<void> {
	await unlink(input).catch(() => undefined);
}

export async function createJob({
	name,
	sourceSize,
	body,
	options,
}: {
	name: string;
	sourceSize: number;
	body: ReadableStream<Uint8Array>;
	options: TranscodeOptions;
}): Promise<TranscodeJob> {
	await ensureDirs();

	const id = randomUUID();
	const ext = path.extname(name).toLowerCase() || ".mp4";
	const inputPath = path.join(TMP_DIR, `${id}${ext}`);
	const outputPath = path.join(OUT_DIR, `${id}.mp4`);

	const job: TranscodeJob = {
		id,
		name,
		status: "uploading",
		progress: 0,
		speed: null,
		fps: null,
		outTimeMs: 0,
		durationMs: 0,
		sourceSize,
		outputSize: 0,
		outputName: `${path.basename(name, path.extname(name))}_web.mp4`,
		codec: null,
		profile: null,
		pixFmt: null,
		width: null,
		height: null,
		error: null,
		createdAt: Date.now(),
		finishedAt: null,
	};
	jobs.set(id, job);

	// 必须在请求生命周期内把 body 写完：Next 的 Request body 在响应返回后会被销毁，
	// 之前用后台 IIFE 写入，ffmpeg 拿到的是空文件（moov atom not found）。
	// 前端 XHR 本来就要等上传完成，所以这里 await 不影响体验；转码仍在后台跑。
	try {
		await pipeline(
			Readable.fromWeb(
				body as unknown as Parameters<typeof Readable.fromWeb>[0],
			),
			createWriteStream(inputPath),
		);

		if (job.status === "cancelled") {
			await cleanupInput(inputPath);
			return job;
		}

		job.status = "probing";
		const probe = await runProbe(inputPath);
		job.durationMs = probe.durationMs;
		job.codec = probe.codec;
		job.profile = probe.profile;
		job.pixFmt = probe.pixFmt;
		job.width = probe.width;
		job.height = probe.height;

		startFfmpeg({ job, input: inputPath, output: outputPath, options });
	} catch (error) {
		job.status = "error";
		job.error =
			error instanceof Error ? error.message : "上传/转码初始化失败";
		job.finishedAt = Date.now();
		await cleanupInput(inputPath);
	}

	return job;
}

export function getJob(id: string): TranscodeJob | null {
	return jobs.get(id) ?? null;
}

export function listJobs(): TranscodeJob[] {
	return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function cancelJob(id: string): boolean {
	const job = jobs.get(id);
	if (!job) return false;
	if (job.status === "done" || job.status === "error") return false;

	job.status = "cancelled";
	job.finishedAt = Date.now();
	processes.get(id)?.kill("SIGKILL");
	return true;
}

export function outputPathFor(id: string): string {
	return path.join(OUT_DIR, `${id}.mp4`);
}

export interface CacheEntry {
	id: string;
	size: number;
	createdAt: number;
}

export async function listCache(): Promise<CacheEntry[]> {
	await ensureDirs();
	const entries = await readdir(OUT_DIR, { withFileTypes: true });
	const result: CacheEntry[] = [];

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".mp4")) continue;
		const full = path.join(OUT_DIR, entry.name);
		try {
			const info = await stat(full);
			result.push({
				id: entry.name.replace(/\.mp4$/, ""),
				size: info.size,
				createdAt: info.mtimeMs,
			});
		} catch {
			// 文件在扫描过程中被删，忽略
		}
	}

	return result.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCache(id: string): Promise<boolean> {
	if (!/^[a-f0-9-]{8,}$/i.test(id)) return false;
	await unlink(path.join(OUT_DIR, `${id}.mp4`)).catch(() => undefined);
	jobs.delete(id);
	return true;
}

export async function diskStats(): Promise<{
	totalBytes: number;
	freeBytes: number;
	usedBytes: number;
	cacheBytes: number;
	cacheCount: number;
}> {
	await ensureDirs();
	let totalBytes = 0;
	let freeBytes = 0;
	try {
		const stats = await statfs(MEDIA_ROOT);
		totalBytes = stats.blocks * stats.bsize;
		freeBytes = stats.bavail * stats.bsize;
	} catch {
		// statfs 不可用时保持 0
	}

	const cache = await listCache();
	return {
		totalBytes,
		freeBytes,
		usedBytes: totalBytes - freeBytes,
		cacheBytes: cache.reduce((sum, item) => sum + item.size, 0),
		cacheCount: cache.length,
	};
}

/** 供调试：确认 ffmpeg 在镜像里可用 */
export async function ffmpegVersion(): Promise<string | null> {
	return new Promise((resolve) => {
		const proc = spawn("ffmpeg", ["-version"]);
		let out = "";
		proc.stdout?.on("data", (chunk) => {
			out += chunk.toString();
		});
		proc.on("error", () => resolve(null));
		proc.on("close", () => resolve(out.split("\n")[0] ?? null));
	});
}

export async function readJobFile(id: string): Promise<Buffer | null> {
	try {
		return await readFile(outputPathFor(id));
	} catch {
		return null;
	}
}

export async function persistJob(job: TranscodeJob): Promise<void> {
	await ensureDirs();
	await writeFile(
		path.join(MEDIA_ROOT, "jobs", `${job.id}.json`),
		JSON.stringify(job, null, 2),
	).catch(() => undefined);
}
