"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { HEIGHT_OPTIONS, type TranscodeHeightChoice } from "@/media/transcode-preference";
import { formatStorageBytes } from "@/services/storage/quota";

export interface PendingTranscodeItem {
	file: File;
	codec: string | null;
}

export interface TranscodeDecision {
	action: "transcode" | "skip";
	height: TranscodeHeightChoice;
	remember: boolean;
}

const CODEC_LABELS: Record<string, string> = {
	hevc: "HEVC / H.265",
	h265: "HEVC / H.265",
	av1: "AV1",
	vp9: "VP9",
	prores: "ProRes",
};

function codecLabel(codec: string | null): string {
	if (!codec) return "未知编码";
	return CODEC_LABELS[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function TranscodeConfirmDialog({
	open,
	items,
	ffmpegAvailable,
	initialHeight,
	onDecide,
}: {
	open: boolean;
	items: PendingTranscodeItem[];
	ffmpegAvailable: boolean;
	initialHeight: TranscodeHeightChoice;
	onDecide: (decision: TranscodeDecision) => void;
}) {
	const [height, setHeight] = useState<TranscodeHeightChoice>(initialHeight);

	const decide = (decision: Omit<TranscodeDecision, "height">) => {
		onDecide({ ...decision, height });
	};

	const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
	const visible = items.slice(0, 4);
	const rest = items.length - visible.length;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) decide({ action: "skip", remember: false });
			}}
		>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>这些素材浏览器解不了</DialogTitle>
					<DialogDescription>
						可以在服务器上转成剪辑用的 H.264 再导入。转码在服务端进行，浏览器只负责上传和接收结果；服务器只保留转码后的文件。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-4">
					<div className="space-y-1.5">
						{visible.map((item) => (
							<div
								key={`${item.file.name}-${item.file.size}`}
								className="flex items-baseline justify-between gap-3 text-sm"
							>
								<span className="truncate font-medium">{item.file.name}</span>
								<span className="shrink-0 text-xs text-muted-foreground">
									{codecLabel(item.codec)} · {formatStorageBytes({ bytes: item.file.size })}
								</span>
							</div>
						))}
						{rest > 0 ? (
							<div className="text-xs text-muted-foreground">
								还有 {rest} 个文件，共 {formatStorageBytes({ bytes: totalBytes })}
							</div>
						) : null}
					</div>

					<div className="space-y-2">
						<Label htmlFor="transcode-height">转码分辨率</Label>
						<Select
							value={height}
							onValueChange={(value) => setHeight(value as TranscodeHeightChoice)}
						>
							<SelectTrigger id="transcode-height" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{HEIGHT_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										<span className="flex flex-col items-start">
											<span>{option.label}</span>
											<span className="text-xs text-muted-foreground">
												{option.hint}
											</span>
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{!ffmpegAvailable ? (
						<p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							服务端没有找到 ffmpeg，转码不可用。请检查容器是否装上了 ffmpeg。
						</p>
					) : (
						<p className="text-xs text-muted-foreground">
							转码时间大约是素材时长的 1–3 倍（4K 保持原分辨率会更久），期间可以继续做别的。
						</p>
					)}
				</DialogBody>

				<DialogFooter className="gap-2">
					<Button
						variant="ghost"
						onClick={() => decide({ action: "skip", remember: false })}
					>
						跳过，直接导入
					</Button>
					<Button
						variant="outline"
						disabled={!ffmpegAvailable}
						onClick={() => decide({ action: "transcode", remember: false })}
					>
						仅此次转码
					</Button>
					<Button
						disabled={!ffmpegAvailable}
						onClick={() => decide({ action: "transcode", remember: true })}
					>
						长期允许，直接转
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
