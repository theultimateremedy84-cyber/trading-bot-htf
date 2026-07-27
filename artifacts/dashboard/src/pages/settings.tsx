import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetSettings, useUpdateSettings, useGetBotStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Save, AlertTriangle } from "lucide-react";

const settingsSchema = z.object({
  riskPerTrade: z.coerce.number().min(0.1).max(5),
  maxOpenTrades: z.coerce.number().min(1).max(20),
  dailyLossLimit: z.coerce.number().min(1).max(10),
  minRR: z.coerce.number().min(1).max(10),
  minConfidence: z.coerce.number().min(50).max(100),
  useOrderBlocks: z.boolean(),
  useFairValueGaps: z.boolean(),
  useLiquiditySweeps: z.boolean(),
  useBOS: z.boolean(),
  useChoCH: z.boolean(),
  trailingStop: z.boolean(),
  capitalApiKey: z.string().min(1, "API Key is required"),
  isDemo: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { data: status } = useGetBotStatus();
  
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      riskPerTrade: 1,
      maxOpenTrades: 5,
      dailyLossLimit: 5,
      minRR: 2,
      minConfidence: 75,
      useOrderBlocks: true,
      useFairValueGaps: true,
      useLiquiditySweeps: true,
      useBOS: true,
      useChoCH: false,
      trailingStop: true,
      capitalApiKey: "",
      isDemo: true,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        riskPerTrade: settings.riskPerTrade,
        maxOpenTrades: settings.maxOpenTrades,
        dailyLossLimit: settings.dailyLossLimit,
        minRR: settings.minRR,
        minConfidence: settings.minConfidence,
        useOrderBlocks: settings.useOrderBlocks,
        useFairValueGaps: settings.useFairValueGaps,
        useLiquiditySweeps: settings.useLiquiditySweeps,
        useBOS: settings.useBOS,
        useChoCH: settings.useChoCH,
        trailingStop: settings.trailingStop,
        capitalApiKey: settings.capitalApiKey,
        isDemo: settings.isDemo,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: SettingsFormValues) => {
    updateSettings.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Settings updated successfully" });
        },
        onError: () => {
          toast({ title: "Failed to update settings", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_CONFIG...</div>;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">System Configuration</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Adjust risk parameters and ICT logic</p>
      </div>

      {status?.running && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-sm flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Bot is currently running.</strong> Changes to risk parameters will only affect new trades. To ensure safety, consider halting the bot before modifying critical settings.
          </div>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Risk Management */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Risk Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="riskPerTrade">Risk Per Trade (%)</Label>
                <Input id="riskPerTrade" type="number" step="0.1" {...form.register("riskPerTrade")} className="font-mono" />
                {form.formState.errors.riskPerTrade && <p className="text-[10px] text-destructive">{form.formState.errors.riskPerTrade.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxOpenTrades">Max Open Trades</Label>
                <Input id="maxOpenTrades" type="number" {...form.register("maxOpenTrades")} className="font-mono" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dailyLossLimit">Daily Loss Limit (%)</Label>
                <Input id="dailyLossLimit" type="number" step="0.1" {...form.register("dailyLossLimit")} className="font-mono" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="minRR">Minimum R:R</Label>
                <Input id="minRR" type="number" step="0.1" {...form.register("minRR")} className="font-mono" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="trailingStop" className="cursor-pointer">Use Trailing Stop</Label>
                <Controller
                  name="trailingStop"
                  control={form.control}
                  render={({ field }) => (
                    <Switch id="trailingStop" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Strategy Logic */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">ICT Logic Components</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 pb-4 border-b border-border/50">
                <Label>Minimum Confidence Threshold</Label>
                <Controller
                  name="minConfidence"
                  control={form.control}
                  render={({ field }) => (
                    <div className="flex items-center gap-4">
                      <Slider 
                        min={50} max={100} step={1} 
                        value={[field.value]} 
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="flex-1"
                      />
                      <span className="font-mono text-sm w-12 text-right">{field.value}%</span>
                    </div>
                  )}
                />
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="useOrderBlocks" className="cursor-pointer">Order Blocks (OB)</Label>
                  <Controller name="useOrderBlocks" control={form.control} render={({ field }) => <Switch id="useOrderBlocks" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="useFairValueGaps" className="cursor-pointer">Fair Value Gaps (FVG)</Label>
                  <Controller name="useFairValueGaps" control={form.control} render={({ field }) => <Switch id="useFairValueGaps" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="useLiquiditySweeps" className="cursor-pointer">Liquidity Sweeps</Label>
                  <Controller name="useLiquiditySweeps" control={form.control} render={({ field }) => <Switch id="useLiquiditySweeps" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="useBOS" className="cursor-pointer">Break of Structure (BOS)</Label>
                  <Controller name="useBOS" control={form.control} render={({ field }) => <Switch id="useBOS" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="useChoCH" className="cursor-pointer">Change of Character (ChoCH)</Label>
                  <Controller name="useChoCH" control={form.control} render={({ field }) => <Switch id="useChoCH" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Broker Integration */}
          <Card className="border-border md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Broker Integration (Capital.com)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="capitalApiKey">API Key</Label>
                <Input id="capitalApiKey" type="password" {...form.register("capitalApiKey")} className="font-mono font-medium" />
                {form.formState.errors.capitalApiKey && <p className="text-[10px] text-destructive">{form.formState.errors.capitalApiKey.message}</p>}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Controller
                  name="isDemo"
                  control={form.control}
                  render={({ field }) => (
                    <Switch id="isDemo" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
                <div className="space-y-0.5 flex-1">
                  <Label htmlFor="isDemo" className="cursor-pointer">Demo Account Mode</Label>
                  <CardDescription>If enabled, trades are routed to the Capital.com demo environment.</CardDescription>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateSettings.isPending} className="w-full sm:w-auto font-mono text-xs">
            <Save className="mr-2 h-4 w-4" />
            COMMIT_CHANGES
          </Button>
        </div>
      </form>
    </div>
  );
}
