package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "skills")
public class skillEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Enumerated(EnumType.STRING)
    private linhCanEnum linhCan;
    private String code;
    private String name;
    private String description;
    private String icon;
    private int mpTieuHao;
    private int hoiChieu;
    private int satThuong;
    private int dienRong;
    private statsEmbed stats;
    private int thoiGianBuff;
    @Enumerated(EnumType.STRING)
    private skillType type;
    private String sfx_code;

    public String getSfx_code() {
        return sfx_code;
    }

    public void setSfx_code(String sfx_code) {
        this.sfx_code = sfx_code;
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public linhCanEnum getLinhCan() {
        return linhCan;
    }

    public void setLinhCan(linhCanEnum linhCan) {
        this.linhCan = linhCan;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public int getMpTieuHao() {
        return mpTieuHao;
    }

    public void setMpTieuHao(int mpTieuHao) {
        this.mpTieuHao = mpTieuHao;
    }

    public int getHoiChieu() {
        return hoiChieu;
    }

    public void setHoiChieu(int hoiChieu) {
        this.hoiChieu = hoiChieu;
    }

    public int getSatThuong() {
        return satThuong;
    }

    public void setSatThuong(int satThuong) {
        this.satThuong = satThuong;
    }

    public int getDienRong() {
        return dienRong;
    }

    public void setDienRong(int dienRong) {
        this.dienRong = dienRong;
    }

    public statsEmbed getStats() {
        return stats;
    }

    public void setStats(statsEmbed stats) {
        this.stats = stats;
    }

    public int getThoiGianBuff() {
        return thoiGianBuff;
    }

    public void setThoiGianBuff(int thoiGianBuff) {
        this.thoiGianBuff = thoiGianBuff;
    }

    public skillType getType() {
        return type;
    }

    public void setType(skillType type) {
        this.type = type;
    }

}
