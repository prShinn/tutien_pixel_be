package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="dot_pha_canh_gioi")
public class dotPhaCanhGioiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String canhGioiCode;
    private int tangThu;
    private int tuViDotPha;
    private String vatPhamDotPha;
    private int xuDotPha;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getCanhGioiCode() {
        return canhGioiCode;
    }

    public void setCanhGioiCode(String canhGioiCode) {
        this.canhGioiCode = canhGioiCode;
    }

    public int getTangThu() {
        return tangThu;
    }

    public void setTangThu(int tangThu) {
        this.tangThu = tangThu;
    }

    public int getTuViDotPha() {
        return tuViDotPha;
    }

    public void setTuViDotPha(int tuViDotPha) {
        this.tuViDotPha = tuViDotPha;
    }

    public String getVatPhamDotPha() {
        return vatPhamDotPha;
    }

    public void setVatPhamDotPha(String vatPhamDotPha) {
        this.vatPhamDotPha = vatPhamDotPha;
    }

    public int getXuDotPha() {
        return xuDotPha;
    }

    public void setXuDotPha(int xuDotPha) {
        this.xuDotPha = xuDotPha;
    }
}
