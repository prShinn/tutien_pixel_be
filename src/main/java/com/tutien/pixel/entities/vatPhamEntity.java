package com.tutien.pixel.entities;

import com.tutien.pixel.entities.enums.capTrangBi;
import com.tutien.pixel.entities.enums.loaiTrangBi;
import jakarta.persistence.*;

@Entity
@Table(name = "vatPham")
public class vatPhamEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
    @Column(unique = true)
    private String code;
    private String description;
    private String icon;
    @Enumerated(EnumType.STRING)
    private loaiTrangBi type;
    private int giaBan;
    private int giaMua;
    private int giaTriTuVi;
    @Enumerated(EnumType.STRING)
    private statsEmbed giaTriTang;
    @Enumerated(EnumType.STRING)
    private capTrangBi capTrangBi;

    public capTrangBi getCapTrangBi() {
        return capTrangBi;
    }

    public void setCapTrangBi(capTrangBi capTrangBi) {
        this.capTrangBi = capTrangBi;
    }

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

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
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

    public loaiTrangBi getType() {
        return type;
    }

    public void setType(loaiTrangBi type) {
        this.type = type;
    }

    public int getGiaBan() {
        return giaBan;
    }

    public void setGiaBan(int giaBan) {
        this.giaBan = giaBan;
    }

    public int getGiaMua() {
        return giaMua;
    }

    public void setGiaMua(int giaMua) {
        this.giaMua = giaMua;
    }

    public int getGiaTriTuVi() {
        return giaTriTuVi;
    }

    public void setGiaTriTuVi(int giaTriTuVi) {
        this.giaTriTuVi = giaTriTuVi;
    }

    public statsEmbed getGiaTriTang() {
        return giaTriTang;
    }

    public void setGiaTriTang(statsEmbed giaTriTang) {
        this.giaTriTang = giaTriTang;
    }
}
