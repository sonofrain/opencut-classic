"use client";

import { useCallback, useEffect, useState } from "react";

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
import { Progress } from "@/components/ui/progress";
import {
	deleteCachedTranscode,
	fetchMediaStats,
	type MediaStats,
} from "@/media/transcode-client";
import {
	formatStorageBytes,
	readStorageQuotaStatus,
	type StorageQuotaStatus,
} from "@/services/storage/quota";

const POLL_INTERVAL_MS = 1500;

const STATUS_LABELS: Record<string, string> = {
	uploading: "上传中",
	probing: "读取信息",
	running: "转码中",
	done: "已完成",
	error: "失败",
	cancelled: "已取消",
};

function formatPercent(value: number): string {
	return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
}

export function TranscodeManagerDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [stats, setStats] = useState<MediaStats | null>(null);
	const [quota, setQuota] = useState<StorageQuotaStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [nextStats, nextQuota] = await Promise.all([
				fetchMediaStats(),
				readStorageQuotaStatus().catch(() => null),
			]);
			setStats(nextStats);
			setQuota(nextQuota);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "读取状态失败");
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		void refresh();
		const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [open, refresh]);

	const removeOne = async (id: string) => {
		setBusyId(id);
		try {
			await deleteCachedTranscode(id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "删除失败");
		} finally {
			setBusyId(null);
		}
	};

	const clearAll = async () => {
		if (!stats || stats.cache.length === 0) return;
		setBusyId("__all__");
		try {
			for (const item of stats.cache) {
				await deleteCachedTranscode(item.id).catch(() => undefined);
			}
			await refresh();
		} finally {
			setBusyId(null);
		}
	};

	const disk = stats?.disk;
	const diskUsedPercent =
		disk && disk.totalBytes > 0
			? ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100
			: 0;

	const activeJobs = (stats?.jobs ?? []).filter(
		(job) =>
			job.status === "uploading" ||
			job.status === "probing" ||
			job.status === "running",
	);
	const recentJobs = (stats?.jobs ?? [])
		.filter(
			(job) =>
				job.status === "done" ||
				job.status === "error" ||
				job.status === "cancelled",
		)
		.slice(0, 4);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>素材转码</DialogTitle>
					<DialogDescription>
						服务端转码把浏览器解不了的素材（HEVC、10bit、ProRes）转成 H.264 8bit 4:2:0。服务器只保留转码后的文件。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
					{error ? (
						<p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							{error}
						</p>
					) : null}

					<section className="space-y-2">
						<div className="flex items-baseline justify-between">
							<h3 className="text-sm font-medium">服务端磁盘</h3>
							<span className="text-xs text-muted-foreground">
								{disk
									? `可用 ${formatStorageBytes({ bytes: disk.freeBytes })} / 共 ${formatStorageBytes({ bytes: disk.totalBytes })}`
									: "读取中…"}
							</span>
						</div>
						<Progress value={diskUsedPercent} className="h-2" />
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span>
								转码缓存 {disk ? formatStorageBytes({ bytes: disk.cacheBytes }) : "—"}（
								{disk?.cacheCount ?? 0} 个）
							</span>
							<span>
								浏览器存储{" "}
								{quota &&
								quota.usageBytes !== null &&
								quota.quotaBytes !== null
									? `${formatStorageBytes({ bytes: quota.usageBytes })} / ${formatStorageBytes({ bytes: quota.quotaBytes })}`
									: "—"}
							</span>
							<span>{stats?.ffmpeg ?? "ffmpeg 不可用"}</span>
						</div>
					</section>

					<section className="space-y-2">
						<h3 className="text-sm font-medium">进行中</h3>
						{activeJobs.length === 0 ? (
							<p className="text-xs text-muted-foreground">没有正在转码的任务</p>
						) : (
							activeJobs.map((job) => (
								<div key={job.id} className="space-y-1">
									<div className="flex items-baseline justify-between gap-3 text-xs">
										<span className="truncate">{job.name}</span>
										<span className="shrink-0 text-muted-foreground">
											{STATUS_LABELS[job.status] ?? job.status} ·{" "}
											{formatPercent(job.progress)}
											{job.speed ? ` · ${job.speed}` : ""}
										</span>
									</div>
									<Progress value={job.progress} className="h-1.5" />
								</div>
							))
						)}
					</section>

					{recentJobs.length > 0 ? (
						<section className="space-y-1">
							<h3 className="text-sm font-medium">最近任务</h3>
							{recentJobs.map((job) => (
								<div
									key={job.id}
									className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
								>
									<span className="truncate">{job.name}</span>
									<span className="shrink-0">
										{STATUS_LABELS[job.status] ?? job.status}
										{job.status === "done"
											? ` · ${formatStorageBytes({ bytes: job.outputSize })}`
											: ""}
									</span>
								</div>
							))}
						</section>
					) : null}

					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-medium">转码缓存</h3>
							{stats && stats.cache.length > 0 ? (
								<Button
									variant="ghost"
									size="sm"
									disabled={busyId !== null}
									onClick={() => void clearAll()}
								>
									清空
								</Button>
							) : null}
						</div>
						{!stats || stats.cache.length === 0 ? (
							<p className="text-xs text-muted-foreground">还没有转码产物</p>
						) : (
							<div className="space-y-1">
								{stats.cache.map((item) => (
									<div
										key={item.id}
										className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-1.5"
									>
										<div className="min-w-0">
											<p className="truncate text-xs">
												{item.name ?? item.id}
											</p>
											<p className="text-[11px] text-muted-foreground">
												{formatStorageBytes({ bytes: item.size })} ·{" "}
												{new Date(item.createdAt).toLocaleString()}
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											disabled={busyId !== null}
											onClick={() => void removeOne(item.id)}
										>
											删除
										</Button>
									</div>
								))}
							</div>
						)}
					</section>

				</DialogBody>

				<DialogFooter>
					<Button variant="outline" onClick={() => void refresh()}>
						刷新
					</Button>
					<Button onClick={() => onOpenChange(false)}>关闭</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
