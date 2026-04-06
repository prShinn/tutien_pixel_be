package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "quest")
public class nhiemVuEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
    private int levelYeuCau;
    private String noiDung;
    private int soLuong;
    private int daThucHien;
    private int thuongTien;
    private int thuongDo;
    private int tyLe;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getLevelYeuCau() {
        return levelYeuCau;
    }

    public void setLevelYeuCau(int levelYeuCau) {
        this.levelYeuCau = levelYeuCau;
    }

    public String getNoiDung() {
        return noiDung;
    }

    public void setNoiDung(String noiDung) {
        this.noiDung = noiDung;
    }

    public int getSoLuong() {
        return soLuong;
    }

    public void setSoLuong(int soLuong) {
        this.soLuong = soLuong;
    }

    public int getDaThucHien() {
        return daThucHien;
    }

    public void setDaThucHien(int daThucHien) {
        this.daThucHien = daThucHien;
    }

    public int getThuongTien() {
        return thuongTien;
    }

    public void setThuongTien(int thuongTien) {
        this.thuongTien = thuongTien;
    }

    public int getThuongDo() {
        return thuongDo;
    }

    public void setThuongDo(int thuongDo) {
        this.thuongDo = thuongDo;
    }

    public int getTyLe() {
        return tyLe;
    }

    public void setTyLe(int tyLe) {
        this.tyLe = tyLe;
    }
}
